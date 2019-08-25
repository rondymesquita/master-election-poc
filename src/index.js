'use strict'
const log = require('./log.js');
const App = require('./app.js');
// const ID = process.env.ID

const ID = Math.ceil(Math.random() * 11) + '';
const app = new App(ID)
app.start()

console.log('Application started on:%s', ID);
