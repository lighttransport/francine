'use strict';

var WebSocket = require('ws');

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
    ws.on('message', function onMessage(message) {
      if (typeof message !== 'object') {
        ws.send({ error: 'invalid WebSocket message format' });
        ws.close();
        return;
      }

      var command = message.command;
      if (!command || typeof command !== 'string') {
        ws.send({ error: 'command name must be a string' });
        ws.close();
        return;
      }

      var requestId = message.requestId;
      if (requestId && typeof requestId !== 'number') {
        ws.send({ error: 'request ID must be a number' });
        ws.close();
        return;
      }

      function reply(body) {
        ws.send(
          concatObject({
            command: command,
            requestId: requestId
          }, body));
      }

      var result;
      switch (command) {
        case 'info':
          reply(master.getClusterInfo());
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
          reply(master.registerResourceTokenByToken(
              message.resourceName,
              message.code,
              authToken));
          break;

        case 'createSession':
          reply(master.createSession(message, authToken));
          break;

        case 'getSession':
          reply(master.getSession(message.sessionName, authToken));
          break;

        case 'deleteSession':
          reply(master.deleteSession(message.sessionName, authToken));
          break;

        case 'createExecution':
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
