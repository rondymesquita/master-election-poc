"use strict";

const redis = require("redis");
const chalk = require("chalk");
const { promisify } = require("util");

const Logger = require("./logger.js");
let logger = null;
const MessageHandler = require("./message-handler");
const Node = require("./node");

const ON_NODE_ELECT = "election:done";
const ON_MESSAGE = "election:message";
const ON_NODE_ENTER = "election:node_entered";

const STORE_NODES = "election:store:nodes";
const STORE_MASTER_ID = "election:store:master_id";

const max = 10;
let count = 0;

const redisOptions = {
  host: "localhost",
  port: 6379
};
const sub = redis.createClient(redisOptions);
const pub = redis.createClient(redisOptions);
const client = redis.createClient(redisOptions);

const add = promisify(client.lpush).bind(client);
const list = promisify(client.lrange).bind(client);
const del = promisify(client.lrem).bind(client);
const get = promisify(client.hget).bind(client);
const delKey = promisify(client.del).bind(client);

const sleep = (time = 1) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, time * 1000);
  });
};

class Params {
  constructor(masterID, age) {
    this.masterID = masterID
    this.age = parseInt(age);
  }
}

class Criterions {
  constructor(senderID, params) {
    this.senderID = senderID
    this.params = params
  }
}

class Election {
  constructor(id) {
    this.id = id;
  }
}

module.exports = class App {
  constructor(id) {
    this.id = id;
    this.criterions = new Criterions(id, new Params(id, id));
    this.whoSaysItsMe = [];
    logger = new Logger(id);
  }

  async start() {
    await Promise.all([
      delKey(STORE_NODES),
      delKey(STORE_MASTER_ID)
      // add(STORE_NODES, this.id)
    ]);

    const messageHandler = new MessageHandler();
    messageHandler.onMessageSubscription(async count => {
      await sleep(5);
      const isSaved = await Node.isSaved(this.id);
      if (!isSaved) {
        await Node.add(this.id);
        logger.info("[onMessageSubscription] New node added on list:", this.id);
        messageHandler.emitNodeEnter(new Election(this.id));
      }
    });

    messageHandler.onMessage(async criterions => {
      await sleep();

      const nodes = await Node.list();

      if (nodes.length === 0) {
        logger.info("[On Message] No clients, I`m the master", this.id);
        messageHandler.emitNodeElected(new Election(this.id));
        return;
      } else if (nodes.length === 1 && nodes[0] === this.id) {
        logger.info(
          "[On Message] Only me on the list, I`m the master",
          this.id
        );
        messageHandler.emitNodeElected(new Election(this.id));
        return;
      }

      if (this.id === criterions.senderID) {
        return
      }

      logger.info("[On Message] criterions", criterions, this.id, criterions.senderID === this.id);

      if (this._betterThan(criterions)) {
        consola.info("********** Sending my criterions", this.criterions);
        messageHandler.emitMessage(
          this.criterions
        );
      } else {
        consola.info("========== Sending received", criterions);
        messageHandler.emitMessage(
          new Criterions(this.id, criterions.params)
        );
      }

      const {isDone, masterID } = await this._isStopConditionReached(criterions)
      if (isDone) {
        logger.success('[On Message] Stop condition reached! Master is: ', masterID)
        messageHandler.emitNodeElected(new Election(masterID))
        // pub.publish(ON_NODE_ELECT, JSON.stringify({id: masterID}) );
        return
      }
    });

    messageHandler.onNodeEnter(async election => {
      await sleep();
      // Ignore when node enter event is triggered by myself
      if (this.id === election.id) {
        return;
      }

      logger.info("[OnNodeEnter] node entered", election, this.id);
      messageHandler.startElection(this.criterions);
    });

    messageHandler.onNodeElected(async election => {
      await sleep();
      logger.success(chalk.green("MASTER ELECTED " + election.id));
      messageHandler.stopElection();
    });

    /*
      TODO: start election only when a node loses connection with its master
     */
    messageHandler.startElection(this.criterions);
  }

  _betterThan(criterions) {
    console.log();
    logger.info('Comparing\n', this.criterions.params);
    logger.info('With\n', criterions);
    console.log();
    return this.criterions.params.age >= criterions.params.age;
  }

  // async _getClients() {
  //   const clients = await list(STORE_NODES, 0, -1)
  //   return clients;
  // }

  async _isStopConditionReached(criterions) {
    logger.info("Checking stop condition", this.id, criterions);
    let nodes = await Node.list()
    const nodesLengthExceptMe = nodes.filter((node) => {
      return node !== this.id
    }).length

    logger.info("nodeCountsExceptMe", nodesLengthExceptMe);
    logger.info("nodes", nodes);
    logger.info("whoSaysItsMe", this.whoSaysItsMe);

    // logger.info('$$$$$$$$$$$$$$$$$$$$$ ', criterions.senderID, this.id);
    // if (criterions.senderID === this.id) {
    //   logger.info('======================= Ignoring myself');
    //   return {isDone: false, masterID: null}
    // }

    const heSayItsMe = parseInt(criterions.params.masterID) == parseInt(this.id)

    logger.info('$$$$$$$$ heSayItsMe', heSayItsMe);
    logger.info('$$$$$$$$ criterions', criterions);
    logger.info('$$$$$$$$ id', this.id);
    const senderID = criterions.senderID
    if (heSayItsMe && !this.whoSaysItsMe.includes(senderID)) {
      this.whoSaysItsMe.push(senderID)
      logger.info('$$$$$$$$ added on the list', senderID);
      logger.info('$$$$$$$$ list', this.whoSaysItsMe);
    }

    //final check
    if (nodesLengthExceptMe == this.whoSaysItsMe.length) {
      console.log('Stop condition reached')
      return {isDone: true, masterID: this.id}
    } else {
      console.log('Election keep going')
      return {isDone: false, masterID: null}
    }
  }
};
