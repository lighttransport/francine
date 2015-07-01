'use strict';

var WebSocket = require('ws');
var concatObject = require('../concat');

var WebSocketServer = WebSocket.Server;

function initializeWsApi(master) {
  var wss = new WebSocketServer({ port: master.getWsPort() });

  function respondReceived(reply) {
    return function(received) {
      if (received.error) {
        reply(received);
      } else {
        reply({
          format: received.format,
          image: received.image.toString('base64')
        });
      }
    };
  }

  wss.on('connection', function onConnection(ws) {
    var authToken;
    var statusIntervalId;

    ws.on('close', function onClose() {
      clearInterval(statusIntervalId);
    });

    ws.on('message', function onMessage(rawMessage) {
      var message;
      try {
        message = JSON.parse(rawMessage);
      } catch (e) {
        ws.send(JSON.stringify({ error: 'invalid WebSocket message format' }));
        ws.close();
        return;
      }

      var command = message.command;
      if (!command || typeof command !== 'string') {
        ws.send(JSON.stringify({ error: 'command name must be a string' }));
        ws.close();
        return;
      }

      var requestId = message.requestId;
      if (requestId && typeof requestId !== 'number') {
        ws.send(JSON.stringify({ error: 'request ID must be a number' }));
        ws.close();
        return;
      }

      function reply(body) {
        ws.send(JSON.stringify(
          concatObject({
            command: command,
            requestId: requestId
          }, body)));
      }

      function onStatusBroadcast() {
        reply(concatObject(master.getStatus(), {
          workers: master.scheduler.getCurrentState().workers,
          tasks: master.scheduler.getTaskStatus()
        }));
      }

      var result;
      switch (command) {
        case 'info':
          reply(master.getClusterInfo());
          break;

        case 'enableStatus':
          if (!statusIntervalId) {
            statusIntervalId = setInterval(
              onStatusBroadcast, master.getStatusInterval());
            master.onStateChange(onStatusBroadcast);
          }
          break;

        case 'authenticate':
          result = master.authenticate(message.userName, message.password);
          if (result.authToken) {
            authToken = result.authToken;
          }
          reply(result);
          break;

        case 'getAuthorizeStatus':
          reply(master.getAuthorizeStatus(message.resourceName, authToken));
          break;

        case 'registerResourceToken':
          master.registerResourceTokenByToken(
                        message.resourceName,
                        message.code,
                        authToken)
          .then(function(result) {
            reply(result);
          });
          break;

        case 'createSession':
          master.log('WebSocket', 'authToken: ' + authToken);
          reply(master.createSession(message, authToken));
          break;

        case 'getSession':
          reply(master.getSession(message.sessionName, authToken));
          break;

        case 'deleteSession':
          reply(master.deleteSession(message.sessionName, authToken));
          break;

        case 'createExecution':
          master.log('WebSocket', 'authToken: ' + authToken);
          result = master.createExecution(message, authToken);
          if (result.error) {
            reply(result);
            break;
          }

          result.reduced.then(function() {
            return master.receiveExecutionResult(
              result.execution.name, authToken);
          }).then(respondReceived(ws)).done();
          break;

        case 'getExecution':
          reply(master.getExecution(message.executionName, authToken));
          break;

        case 'getExecutionResult':
          result.reduced.then(function() {
            return master.receiveExecutionResult(
              message.executionName, authToken);
          }).then(respondReceived(reply)).done();
          break;

        default:
          reply({ error: 'comamnd not found' });
          ws.close();
          break;
      }
    });
  });

  return wss;
}

module.exports = initializeWsApi;
