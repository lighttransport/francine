'use strict';

var Q = require('q');
var express = require('express');
var bodyParser = require('body-parser');

var concatObject = require('../concat');

function initializeRestApi(master) {
  var app = express();

  var jsonParser = bodyParser.json();

  app.get('/info', function(req, res) {
    res.json(master.getClusterInfo());
    res.end();
  });

  app.get('/', function(req, res) {
    var format = 'jpg';
    var sessionName = master.createSession({
      producer: 'ao',
      format: format
    });
    master.createExecution({
      sessionName: sessionName,
      parallel: req.query.parallel ? parseInt(req.query.parallel) : 1 })
    .then(function(reducing) {
      return master.receive(reducing.workerName, reducing.task.name);
    })
    .then(function(image) {
      res.type(format);
      res.end(image);
      master.deleteSession(sessionName);
    }, function(error) {
      res.type('text/plain');
      res.end(error.toString());
      master.deleteSession(sessionName);
    });
  });

  app.post('/sessions', jsonParser, function(req, res) {
    var sessionName = master.createSession(req.body);
    res.json(master.getSession(sessionName));
    res.end();
  });

  app.get('/sessions/:sessionName', jsonParser, function(req, res) {
    var session = master.getSession(req.params.sessionName);
    if (session) {
      res.json(session);
      res.end();
    } else {
      res.status(404).end({ error: 'session not found' });
    }
  });

  app.delete('/sessions/:sessionName', jsonParser, function(req, res) {
    master.deleteSession(req.params.sessionName);
    res.json({});
    res.end();
  });

  app.post('/sessions/:sessionName/executions', jsonParser, function(req, res) {
    var async = !req.query.block;

    var ret = master.createExecution(
        concatObject({ sessionName: req.params.sessionName }, req.body),
        async);

    if (async) {
      res.json(master.getExecution(ret));
      res.end();
    } else {
      ret.then(function(reducing) {
        return master.receive(reducing.workerName, reducing.task.name);
      })
      .then(function(image) {
        res.type(master.getSession(req.params.sessionName).format);
        res.end(image);
      }, function(error) {
        res.type('text/plain');
        res.end(error);
      });
    }
  });

  app.get(
      '/sessions/:sessionName/executions/:executionName',
      jsonParser,
      function(req, res) {
        var execution = master.getExecution(req.params.executionName);
        if (!execution ||
            execution.sessionName !== req.params.sessionName) {
          res.status(404);
          return;
        }

        res.json({
          name: execution.name,
          sessionName: execution.sessionName,
          time: execution.time,
          progress: execution.progress,
          error: execution.error,
          finished: execution.last ? true : false
        });
        res.end();
      });

  app.get(
      '/sessions/:sessionName/executions/:executionName/result',
      jsonParser,
      function(req, res) {
        var execution = master.getExecution(req.params.executionName);
        if (!execution ||
            execution.sessionName !== req.params.sessionName) {
          res.status(404).end({ error: 'execution not found' });
          return;
        }

        Q(execution.last) // jshint ignore:line
        .then(function(reducing) {
          return master.receive(reducing.workerName, reducing.task.name);
        })
        .then(function(image) {
          res.type(master.getSession(execution.sessionName).format);
          res.end(image);
        }).done();
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
