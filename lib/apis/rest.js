'use strict';

var Q = require('q');
var express = require('express');
var bodyParser = require('body-parser');

var concatObject = require('../concat');

function initializeRestApi(master) {
  var app = express();

  var jsonParser = bodyParser.json();

  function respondReceived(res) {
    return function(received) {
      if (received.error) {
        res.json(received);
        res.end();
      } else {
        res.type(received.format);
        res.end(received.image);
      }
      var d = Q.defer();
      d.resolve();
      return d.promise;
    };
  }

  app.get('/', function(req, res) {
    var format = 'jpg';
    var session = master.createSession({
      producer: 'ao',
      format: format
    });
    var result = master.createExecution({
      sessionName: session.name,
      parallel: req.query.parallel ? parseInt(req.query.parallel) : 1 });
    result.reduced.then(function() {
      return master.receiveExecutionResult(result.execution.name);
    })
    .then(respondReceived(res))
    .then(function() {
      master.deleteSession(session.name);
    }).done();
  });

  app.get('/info', function(req, res) {
    res.json(master.getClusterInfo());
    res.end();
  });

  app.post('/auth', jsonParser, function(req, res) {
    res.json(master.authenticate(req.body.userName, req.body.password));
    res.end();
  });

  app.get('/auth/:resourceName', function(req, res) {
    res.json(
      master.getAuthorizeStatus(
        req.params.resourceName,
        req.get('X-API-Token')));
    res.end();
  });

  app.post('/auth/:resourceName', jsonParser, function(req, res) {
    master.registerResourceTokenByToken(
      req.params.resourceName,
      req.body.code,
      req.get('X-API-Token'))
    .then(function(result) {
      res.json(result);
      res.end();
    });
  });

  app.post('/sessions', jsonParser, function(req, res) {
    res.json(master.createSession(req.body, req.get('X-API-Token')));
    res.end();
  });

  app.get('/sessions/:sessionName', jsonParser, function(req, res) {
    res.json(master.getSession(req.params.sessionName, req.get('X-API-Token')));
    res.end();
  });

  app.delete('/sessions/:sessionName', jsonParser, function(req, res) {
    res.json(
      master.deleteSession(req.params.sessionName, req.get('X-API-Token')));
    res.end();
  });

  app.post('/sessions/:sessionName/executions', jsonParser, function(req, res) {
    var token = req.get('X-API-Token');
    var result = master.createExecution(
        concatObject({ sessionName: req.params.sessionName }, req.body),
        token);

    if (result.error) {
      res.json(result);
      res.end();
      return;
    }

    if (req.query.block) {
      result.reduced.then(function() {
        return master.receiveExecutionResult(result.execution.name, token);
      }).then(respondReceived(res)).done();
    } else {
      res.json(result.execution);
      res.end();
    }
  });

  app.get(
    '/sessions/:sessionName/executions/:executionName',
    jsonParser, function(req, res) {
      res.json(
        master.getExecution(req.params.executionName, req.get('X-API-Token')));
      res.end();
    });

  app.get(
    '/sessions/:sessionName/executions/:executionName/result',
    jsonParser,
    function(req, res) {
      master.receiveExecutionResult(
        req.params.executionName, req.get('X-API-Token'))
      .then(respondReceived(res));
    });

  app.listen(master.getRestPort(), function() {
    master.log(
        'RestApi',
        'Waiting on REST port ' + master.getRestPort() +
        ' for REST API request...');
  });

  return app;
}

module.exports = initializeRestApi;
