'use strict';

var express = require('express');
var http = require('http');
var socketio = require('socket.io');

function initializeDashboard(master) {
  var app = express();
  var server = http.Server(app);
  var io = socketio(server);

  app.use('/', express.static(__dirname + '/public'));

  server.listen(master.getDashboardPort(), function listen() {
    master.log(
        'Dashboard',
        'Waiting on dashboard port ' + master.getDashboardPort() + '...');
  });

  io.on('connection', function connection(socket) {
    socket.emit('init', master.getCurrentState());
  });

  master.onStateChange(function onStateChange(state) {
    io.sockets.emit('change', state);
  });
}

module.exports = initializeDashboard;
