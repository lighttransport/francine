'use strict';

var Q = require('q');
var express = require('express');
var jsonrpc = require('multitransport-jsonrpc');
var mkdirp = require('mkdirp');
var fs = require('fs');
var rimraf = require('rimraf');

var JsonRpcServer = jsonrpc.server;
var JsonRpcServerTcp = jsonrpc.transports.server.tcp;
var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var InternalResource = require('./resources/internal');
var DropboxResource = require('./resources/dropbox');

var AoProducer = require('./producers/ao');
var MallieProducer = require('./producers/mallie');
var LteProducer = require('./producers/lte');
var CompositorReducer = require('./reducers/compositor');

function Worker(argv) {
  var _this = this;

  _this.port = argv.port || 5000;
  _this.resourcePort = argv.resourcePort || 9000;
  _this.temporaryDirectory =
      argv.temporaryDirectory || ('/tmp/francine' + (Date.now() | 0));

  _this.rpcServer = null;
  _this.logs = [];
  _this.app = null;

  _this.sessions = {};

  _this.producers = null;
  _this.reducers = null;
}

Worker.prototype.start = function start() {
  var _this = this;

  var francinerc = (process.env.HOME || '/root') + '/.francinerc';
  if (fs.existsSync(francinerc)) {
    _this.configs = JSON.parse(
        fs.readFileSync(francinerc, { encoding: 'utf-8' }));
    _this.log('Master', 'Read configuration form ' + francinerc);

    _this.malliePath = _this.configs.malliePath;
    _this.ltePath = _this.configs.ltePath;
    _this.chaos = _this.configs.chaos;
  } else {
    _this.log('Master', 'No .fracinerc available at ' + francinerc);
  }

  _this._initializeTemporaryDirectory();

  _this._initializeResourceServer();

  _this._initializeRpc();

  _this._initializeProducers();

  _this._initializeReducers();

  process.on('uncaughtException', function(error) {
    _this.log('Worker', error.stack || error);
    _this.sendPong().then(function() {
      process.exit(1);
    });
  });
};

Worker.prototype.failByChaos = function failByChaos() {
  if (Math.random() < this.chaos / 100) {
    throw 'The worker will shut down by chaos!';
  }
};

/**
 * Getters
 */

Worker.prototype.getTemporaryDirectory = function getTemporaryDirectory() {
  return this.temporaryDirectory;
};

Worker.prototype.getMaster = function getMaster() {
  return this.master;
};

Worker.prototype.getName = function getName() {
  return this.workerName;
};

Worker.prototype.getResourcePort = function getResourcePort() {
  return this.resourcePort;
};

/**
 * Logger
 */

Worker.prototype.log = function log(from, message) {
  var _this = this;

  _this.logs.push({
    from: from,
    message: message
  });
  // console.log('Francine: ' + from + ': ' + message);
};

/**
 * Initializers
 */

Worker.prototype._initializeTemporaryDirectory =
function _initializeTemporaryDirectory() {
  var _this = this;

  _this.log('Worker', 'Base temporary directory: ' + _this.temporaryDirectory);

  mkdirp.sync(_this.temporaryDirectory + '/sessions');
  mkdirp.sync(_this.temporaryDirectory + '/executions');
  mkdirp.sync(_this.temporaryDirectory + '/results');
};

Worker.prototype._initializeRpc = function _initializeRpc() {
  var _this = this;

  _this.log(
      'Worker',
      'Waiting on port ' + _this.port + ' for JSON RPC request...');

  _this.rpcServer = new JsonRpcServer(new JsonRpcServerTcp(_this.port), {
    ping: function ping(info, callback) {
      _this.dispatchPing(info);
      _this.sendPong().done();
      callback(null, {});
    },

    run: function run(task, callback) {
      // _this.log('Worker', 'Received task ' + task.name + ' of ' + task.type);
      var startTime = Date.now();

      _this.failByChaos();

      var p;
      switch (task.type) {
        case 'PRODUCING':
          var startFetchingTime = Date.now();
          p = _this._prepareResources(task)
          .then(function() {
            _this._sendFinishFetching(task, Date.now() - startFetchingTime);
            return _this._linkResources(task);
          })
          .then(function() {
            startTime = Date.now();
            return _this.producers[task.session.producer].produce(task);
          })
          .then(function() {
            return _this._unlinkResources(task);
          });
          break;
        case 'REDUCING':
          p = _this.reducers.compositor.reduce(task);
          break;
      }

      p.then(function(weight) {
        _this._sendFinishTask(task, Date.now() - startTime, weight);
      }, function(error) {
        _this.log('Worker', error.toString());
        if (error.stack) {
          _this.log('Worker', error.stack);
        }
        _this._sendFailed(task, error.toString());
        _this._unlinkResources(task);
      });

      callback(null, {});
    },

    deleteCache: function deleteCache(info, callback) {
      _this._deleteResources(info.sessionName);
      var session = _this.sessions[info.sessionName];
      _this.producers[session.producer].deleteCache(info.sessionName);
      delete _this.sessions[info.sessionName];
      callback(null, {});
    }
  });
};

Worker.prototype._initializeResourceServer =
function _initializeResourceServer() {
  var _this = this;

  _this.app = express();

  _this.app.use(express.static(_this.temporaryDirectory));

  _this.app.listen(_this.resourcePort, function() {
    _this.log(
        'Worker',
        'Waiting on Resource port ' + _this.resourcePort +
        ' for Resource request...');
  });
};

Worker.prototype._initializeProducers = function _initializeProducers() {
  var _this = this;
  _this.producers = {};
  _this.producers.ao = new AoProducer(_this);
  _this.producers.mallie = new MallieProducer(_this, _this.malliePath);
  _this.producers.lte = new LteProducer(_this, _this.ltePath);
};

Worker.prototype._initializeReducers = function _initializeReducers() {
  var _this = this;
  _this.reducers = {};
  _this.reducers.compositor = new CompositorReducer(_this);
};

/**
 * Ping / Pong management
 */

Worker.prototype.dispatchPing = function dispatchPing(info) {
  var _this = this;

  _this.workerName = info.workerName;
  _this.master = info.master;
};

Worker.prototype.sendPong = function sendPong() {
  var _this = this;
  var d = Q.defer();

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        _this.master.host,
        _this.master.port,
        { timeout: 10, retries: 0 }));
  client.register('pong');
  client.pong({
    workerName: _this.workerName,
    logs: _this.logs,
    cachedSessions: Object.keys(_this.sessions)
  }, function() {
    client.shutdown();
    d.resolve();
  });

  _this.logs = [];

  return d.promise;
};

/**
 * Finish senders
 */

Worker.prototype._sendFinishTask =
function _sendFinishTask(task, elapsedTime, weight) {
  var _this = this;

  if (!_this.master) {
    return;
  }

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        _this.master.host,
        _this.master.port,
        { timeout: 10, retries: 0 }));
  client.register('finish');
  client.finish({
    type: 'TASK',
    workerName: _this.getName(),
    task: task,
    elapsedTime: elapsedTime,
    weight: weight
  }, function() {
    client.shutdown();
  });
};

Worker.prototype._sendFinishFetching =
function _sendFinishFetching(task, elapsedTime) {
  var _this = this;

  if (!_this.master) {
    return;
  }

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        _this.master.host,
        _this.master.port,
        { timeout: 10, retries: 0 }));
  client.register('finish');
  client.finish({
    type: 'FETCHING',
    workerName: _this.getName(),
    taskName: task.name,
    executionName: task.execution.name,
    cachedSessions: Object.keys(_this.sessions),
    elapsedTime: elapsedTime
  }, function() {
    client.shutdown();
  });
};

Worker.prototype._sendFailed = function sendFailed(task, reason) {
  var _this = this;

  if (!_this.master) {
    return;
  }

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        _this.master.host,
        _this.master.port,
        { timeout: 10, retries: 0 }));
  client.register('failed');
  client.failed({
    taskName: task.name,
    workerName: _this.getName(),
    reason: reason
  }, function() {
    client.shutdown();
  });
};

/**
 * Resource preparation
 */

Worker.prototype._prepareResources = function _prepareResources(task) {
  var _this = this;
  var d;

  if (_this.sessions[task.session.name]) {
    // _this.log('Worker', 'Session cache available.');
    d = Q.defer();
    d.resolve();
    return d.promise;
  }

  // _this.log('Worker', 'Preparing resources...');

  var files = task.session.resources;

  if (!files) {
    // _this.log('Worker', 'No resource required.');
    d = Q.defer();
    d.resolve();
    return d.promise;
  }

  mkdirp.sync(_this.temporaryDirectory + '/sessions/' + task.session.name);

  var i;
  var resources = {};

  if (task.source) {
    for (i = 0; i < files.length; i++) {
      files[i].type = 'internal';
      files[i].index = i;
    }
  }

  for (i = 0; i < files.length; i++) {
    var file = files[i];
    if (resources[file.type]) {
      continue;
    }

    var resource;
    switch (file.type) {
      case 'internal':
        resource = new InternalResource(_this, task.session, task.source);
        break;
      case 'dropbox':
        resource = new DropboxResource();
        resource.initializeInWorker(_this, task.session.tokens[file.type]);
        break;
    }

    resources[file.type] = resource;
  }

  var retrieve = function retrieve(file, index) {
    return function() {
      return resources[file.type].retrieve(
          file,
          _this.temporaryDirectory +
          '/sessions/' + task.session.name + '/resource' + index);
    };
  };

  var q = Q(); // jshint ignore:line
  for (i = 0; i < files.length; i++) {
    q = q.then(retrieve(files[i], i));
  }

  return q.then(function() {
    var d = Q.defer();
    _this.sessions[task.session.name] = task.session;
    d.resolve();
    return d.promise;
  });
};

Worker.prototype._deleteResources = function _deleteResources(sessionName) {
  var _this = this;
  var d = Q.defer();

  rimraf(_this.temporaryDirectory + '/sessions/' + sessionName,
      function(error) {
        if (error) {
          d.reject(error);
        } else {
          d.resolve();
        }
      });

  return d.promise;
};

Worker.prototype._linkResources = function _linkResources(task) {
  var _this = this;
  var d = Q.defer();

  mkdirp.sync(_this.temporaryDirectory + '/executions/' + task.execution.name);
  var files = task.session.resources;

  if (!files) {
    d.resolve();
    return d.promise;
  }

  for (var i = 0; i < files.length; i++) {
    fs.linkSync(
        _this.temporaryDirectory +
        '/sessions/' + task.session.name + '/resource' + i,
        _this.temporaryDirectory +
        '/executions/' + task.execution.name + '/' + files[i].dst);
  }

  d.resolve();
  return d.promise;
};

Worker.prototype._unlinkResources = function _unlinkResources(task) {
  var _this = this;
  var d = Q.defer();
  rimraf(
      _this.temporaryDirectory + '/executions/' + task.execution.name,
      function(error) {
        if (error) {
          d.reject(error);
        } else {
          d.resolve();
        }
      });
  return d.promise;
};

module.exports = Worker;
