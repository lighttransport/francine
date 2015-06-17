'use strict';

var WebSocket = require('ws');

var WebSocketServer = WebSocket.Server;

function initializeWsApi(master) {
  var wss = new WebSocketServer({ port: master.getWsPort() });

  function respondReceived(ws) {
    return function(received) {
      if (received.error) {
        ws.send(received);
      } else {
        ws.send({
          format: received.format,
          image: received.image.toString('base64')
        });
      }
    };
  }

  wss.on('connection', function onConnection(ws) {
    var authToken;
    ws.on('message', function onMessage(message) {
      if (typeof message !== 'object') {
        ws.send({ error: 'invalid WebSocket message format' });
        ws.close();
        return;
      }

      var command = message.command;
      if (!command || typeof command !== 'string') {
        ws.send({ error: 'invalid command' });
        ws.close();
        return;
      }

      var result;
      switch (command) {
        case 'info':
          ws.send(master.getClusterInfo());
          break;

        case 'authenticate':
          result = master.authenticate(message.userName, message.password);
          if (result.authToken) {
            authToken = result.authToken;
          }
          ws.send(result);
          break;

        case 'getAuthorizeStatus':
          ws.send(master.getAuthorizeStatus(message.resourceName, authToken));
          break;

        case 'registerResourceToken':
          ws.send(master.registerResourceTokenByToken(
              message.resourceName,
              message.code,
              authToken));
          break;

        case 'createSession':
          ws.send(master.createSession(message, authToken));
          break;

        case 'getSession':
          ws.send(master.getSession(message.sessionName, authToken));
          break;

        case 'deleteSession':
          ws.send(master.deleteSession(message.sessionName, authToken));
          break;

        case 'createExecution':
          result = master.createExecution(message, authToken);
          if (result.error) {
            ws.send(result);
            break;
          }

          result.reduced.then(function() {
            return master.receiveExecutionResult(
              result.execution.name, authToken);
          }).then(respondReceived(ws));
          break;

        case 'getExecution':
          ws.send(master.getExecution(message.executionName, authToken));
          break;

        case 'getExecutionResult':
          result.reduced.then(function() {
            return master.receiveExecutionResult(
              message.executionName, authToken);
          }).then(respondReceived(ws));
          break;
      }
    });
  });

  return wss;
}

module.exports = initializeWsApi;
