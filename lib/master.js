'use strict';

var Q = require('q');
var request = require('request');
var jsonrpc = require('multitransport-jsonrpc');
var jsonwebtoken = require('jsonwebtoken');

var JsonRpcServer = jsonrpc.server;
var JsonRpcServerTcp = jsonrpc.transports.server.tcp;
var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var Runner = require('./runner');

var LocalInstance = require('./instances/local');
var GceInstance = require('./instances/gce');

var StaticInstanceManager = require('./instance_managers/static');
var TwoStateInstanceManager = require('./instance_managers/twostate');

var QueueScheduler = require('./schedulers/queue');

var DropboxResource = require('./resources/dropbox');

var initializeRestApi = require('./apis/rest');
var initializeDashboard = require('./dashboard/dashboard');

var concatObject = require('./concat');
var executions = require('./executions');

function Master(argv) {
  Runner.call(this, argv);

  this.instance = null;
  this.instanceManager = null;
  this.scheduler = null;

  this.rpcServer = null;
  this.app = null;

  this.master = null;
  this.workers = {};
  this.unrecognizedWorkers = {};
  this.waitingPong = {};

  this.finishTaskDefers = {};
  this.finishFetchingDefers = {};
  this.seed = 0;

  this.resources = null;

  this.sessions = {};
  this.executions = {};

  this.taskTimeouts = {};
  this.taskTimeoutIDs = {};

  this.lastTaskRequestTime = Date.now();
}

Master.prototype = Object.create(Runner.prototype);
Master.prototype.constructor = Master;

Master.prototype.start = function start() {
  var _this = this;

  // Read configuration from .francinerc
  _this.readConfig();
  _this.checkAndDefault();

  // Initialize instance type specific object
  _this._initializeInstance();

  // Initialize instance manager
  _this._initializeInstanceManager();

  // Initialize scheduler
  _this._initializeScheduler();

  // Initialize RPC
  _this._initializeRpc();

  // Initialize REST API
  _this._initializeRestApi();

  // Initialize web dashboard
  _this._initializeDashboard();

  // Initialize resources
  _this._initializeResources();

  _this.loop(_this.manageInterval, function() {
    return _this.instance.getInstances()
    .then(function(instances) {
      return _this.manageWorkers(instances);
    })
    .then(function() {
      return _this.instanceManager.manage();
    });
  }).done();

  setInterval(function() {
    _this.logStatus();
    _this.scheduler.logStatus();
  }, _this.statusInterval);

  process.on('uncaughtException', function(error) {
    _this.log('Master', error.stack || error);
    process.exit(1);
  });
};

Master.prototype.loop = function loop(interval, f) {
  return Q().then(function l() { // jshint ignore:line
    return f().delay(interval).then(l);
  });
};

/**
 * Getters
 */

Master.prototype.getMaster = function getMaster() {
  return this.master;
};

Master.prototype.getWorkers = function getWorkers() {
  return this.workers;
};

Master.prototype.getId = function getId() {
  this.seed++;
  return (Date.now() | 0) + '-' + this.seed;
};

Master.prototype.getSession = function getSession(sessionName, token) {
  var session = this.sessions[sessionName];
  if (!session) {
    return { error: 'session not found' };
  }

  if (session.userName !== this._getUserNameByToken(token)) {
    return { error: 'you are not allowed to see this session.' };
  }

  return session;
};

Master.prototype.getExecution = function getExecution(executionName, token) {
  var execution = this.executions[executionName];

  if (!execution) {
    return { error: 'execution not found' };
  }

  if (this.sessions[execution.sessionName].userName !==
      this._getUserNameByToken(token)) {
    return { error: 'you are not allowed to see this execution.' };
  }

  return {
    name: execution.name,
    sessionName: execution.sessionName,
    time: execution.time,
    progress: execution.progress,
    error: execution.error,
    finished: (execution.last || execution.error) ? true : false
  };
};

Master.prototype.getNextCachedWorker =
function getNextCachedWorker(sessionName) {
  if (!this.sessions[sessionName] ||
      !this.sessions[sessionName].cachedWorkers.length) {
    return null;
  }

  // Take a worker with the session resources from top and shift it back.
  var workerName = this.sessions[sessionName].cachedWorkers.pop();
  this.sessions[sessionName].cachedWorkers.unshift(workerName);

  return this.workers[workerName];
};

Master.prototype.hasCachedWorker = function hasCachedWorker(sessionName) {
  return this.sessions[sessionName].cachedWorkers.length >= 0;
};

Master.prototype.getCurrentState = function getCurrentState() {
  return this.scheduler.getCurrentState();
};

Master.prototype.onStateChange = function onStateChange(fn) {
  return this.scheduler.onStateChange(fn);
};

Master.prototype.getLastTaskRequestTime = function getLastTaskRequestTime() {
  return this.lastTaskRequestTime;
};

/**
 * Logger
 */

Master.prototype.logStatus = function logStatus() {
  var _this = this;
  _this.log(
      'Master',
      'Sessions: ' + Object.keys(_this.sessions).length +
      ' Executions: ' + Object.keys(_this.executions).length +
      ' Timeouts: ' + Object.keys(_this.taskTimeoutIDs).length);
};

/**
 * Initializers
 */

Master.prototype._initializeInstance = function _initializeInstance() {
  var _this = this;

  switch (_this.instanceType) {
    case 'local':
      _this.instance = new LocalInstance(_this);
      break;
    case 'gce':
      _this.instance = new GceInstance(_this, _this.gce);
      break;
  }

  if (!_this.instance) {
    _this.log(
        'Master',
        'Error: Invalid worker instance type ' + _this.instanceType);
    process.exit(1);
  }

  _this.log('Master', 'Worker instance type: ' + _this.instanceType);
};

Master.prototype._initializeInstanceManager =
function _initializeInstanceManager() {
  var _this = this;

  switch (_this.instanceManagerType) {
    case 'static':
      _this.instanceManager = new StaticInstanceManager(
          _this, _this.staticInstanceSize || 8);
      break;
    case 'twostate':
      _this.instanceManager = new TwoStateInstanceManager(
          _this, _this.staticInstanceSize || 8);
  }

  if (!_this.instanceManager) {
    _this.log(
        'Master',
        'Error: Invalid instance manager type ' + _this.instanceManagerType);
    process.exit(1);
  }

  _this.log('Master', 'Instance manager type: ' + _this.instanceManagerType);
};

Master.prototype._initializeRpc = function _initializeRpc() {
  var _this = this;

  _this.log(
      'Master',
      'Waiting on port ' + _this.port + ' for JSON RPC request...');

  _this.rpcServer = new JsonRpcServer(new JsonRpcServerTcp(_this.port), {
    pong: function pong(info, callback) {
      // _this.log('Master', 'Pong received from ' + info.workerName);
      _this.dispatchPong(info);
      callback(null, {});
    },
    finish: function finish(info, callback) {
      // _this.log('Master', 'Finish received from ' + info.workerName);
      _this._dispatchFinish(info);
      callback(null, {});
    },
    failed: function failed(info, callback) {
      _this._dispatchFailed(info);
      callback(null, {});
    }
  });
};

Master.prototype._initializeScheduler = function _initializeScheduler() {
  var _this = this;

  switch (_this.schedulerType) {
    case 'queue':
      _this.scheduler = new QueueScheduler(_this, _this.instance);
      break;
  }

  if (!_this.scheduler) {
    _this.log('Master', 'Error: invalid scheduler type ' + _this.schedulerType);
    process.exit(1);
  }

  _this.log('Master', 'Scheduler type: ' + _this.schedulerType);
};

Master.prototype._initializeRestApi = function _initializeRestApi() {
  this.app = initializeRestApi(this);
};

Master.prototype._initializeDashboard = function _initializeDashboard() {
  initializeDashboard(this);
};

Master.prototype._initializeResources = function _initializeResources() {
  this.resources = {};
  this.resources.dropbox = new DropboxResource();
  this.resources.dropbox.initializeInMaster(this, this.dropbox);
};

/**
 * Ping / Pong and worker management
 */

Master.prototype.resizeWorkers = function resizeWorkers(size) {
  var _this = this;
  return _this.instance.resize(size);
};

Master.prototype.manageWorkers = function manageWorkers(instances) {
  var _this = this;

  var d = Q.defer();

  _this.master = instances.master;
  _this.unrecognizedWorkers = instances.workers;

  if (!_this.master) {
    d.resolve();
    return d.promise;
  }

  // Remove recognized workers that no longer exist
  Object.keys(_this.workers).map(function(recognizedWorkerName) {
    if (!instances.workers[recognizedWorkerName]) {
      _this._removeWorker(recognizedWorkerName);
    }
  });

  // Clean waiting pong list
  Object.keys(_this.waitingPong).map(function(recognizedWorkerName) {
    if (!instances.workers[recognizedWorkerName]) {
      delete _this.waitingPong[recognizedWorkerName];
    }
  });

  /**
   * Recognized instances that failed to reply pings within timeout
   * should be destroyed
   */
  if (!_this.disableZombieDestroy) {
    var destroyed = [];
    for (var workerName in _this.waitingPong) {
      if (_this.waitingPong.hasOwnProperty(workerName)) {
        var count = _this.waitingPong[workerName];
        if (count >= _this.waitingPongTimeout) {
          delete instances.workers[workerName];
          destroyed.push(workerName);
          /**
           * This instance will be terminated,
           * so neither send ping nor dispatch pong
           */
          _this.waitingPong[workerName] = -1;
        }
      }
    }

    if (destroyed.length) {
      _this.instance.destroy(destroyed);
    }
  }

  // Ping to recognized workers
  for (var key in _this.workers) {
    if (_this.workers.hasOwnProperty(key)) {
      var worker = _this.workers[key];
      _this.sendPing(worker);
    }
  }

  // Ping to unrecognized workers
  Object.keys(instances.workers).map(function(unrecognizedWorkerName) {
    if (!_this.workers[unrecognizedWorkerName]) {
      _this.sendPing(instances.workers[unrecognizedWorkerName]);
    }
  });

  _this.scheduler.updateWorkers();
  _this.scheduler.schedule();

  d.resolve();
  return d.promise;
};

Master.prototype._removeWorker = function _removeWorker(recognizedWorkerName) {
  var _this = this;

  delete _this.workers[recognizedWorkerName];

  // Delete the worker from the cached workers list of each session
  var filter = function filter(cachedWorkerName) {
    return cachedWorkerName !== recognizedWorkerName;
  };

  for (var sessionName in _this.sessions) {
    if (_this.sessions.hasOwnProperty(sessionName)) {
      var session = _this.sessions[sessionName];
      if (session.cachedWorkers.indexOf(recognizedWorkerName) >= 0) {
        session.cachedWorkers.filter(filter);
      }
    }
  }
};

Master.prototype.sendPing = function sendPing(worker) {
  var _this = this;

  if (_this.waitingPong[worker.name] && _this.waitingPong[worker.name] < 0) {
    return;
  }

  _this.waitingPong[worker.name] = _this.waitingPong[worker.name] || 0;
  _this.waitingPong[worker.name]++;

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        worker.host,
        worker.port,
        { timeout: 10, retries: 0 }));
  client.register('ping');
  client.ping({
    workerName: worker.name,
    master: _this.getMaster()
  }, function() {
    client.shutdown();
  });
};

Master.prototype.dispatchPong = function dispatchPong(info) {
  var _this = this;

  if (_this.waitingPong[info.workerName] &&
      _this.waitingPong[info.workerName] >= 0) {
    _this.waitingPong[info.workerName] =
      Math.max(_this.waitingPong[info.workerName] - 1, 0);
  }

  if (!_this.workers[info.workerName] &&
      _this.unrecognizedWorkers[info.workerName]) {
    _this.workers[info.workerName] =
      _this.unrecognizedWorkers[info.workerName];

    _this.scheduler.updateWorkers();
    _this.scheduler.schedule();
  }

  _this._appendCachedWorker(info.workerName, info.cachedSessions);

  info.logs.map(function(message) {
    _this.log('[' + info.workerName + '] ' + message.from, message.message);
  });
};

/**
 * Tasks
 */

Master.prototype.runTask = function runTask(workerName, task) {
  var _this = this;

  _this.lastTaskRequestTime = Date.now();

  var worker = _this.workers[workerName];

  if (_this.taskTimeouts[task.name]) {
    var timeout = _this.taskTimeouts[task.name];
    _this.taskTimeoutIDs[task.name] = setTimeout(function() {
      // Remove the worker from the worker list until next ping/pong
      _this._removeWorker(workerName);
      _this.scheduler.updateWorkers();

      _this._dispatchFailed({ taskName: task.name, reason: 'timeout' });
    }, timeout);
  }

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        worker.host,
        worker.port,
        { timeout: 10, retries: 0 }));
  client.register('run');
  client.run(task, function() {
    client.shutdown();
  });
};

/**
 * Finish management
 */

Master.prototype._dispatchFinish = function _dispatchFinish(info) {
  var _this = this;

  _this.scheduler.dispatchFinish(info);

  if (info.type === 'TASK') {
    if (_this.executions[info.task.execution.name]) {
      if (info.task.type === 'PRODUCING') {
        _this.executions[info.task.execution.name].time.producing +=
          info.elapsedTime;
        _this.executions[info.task.execution.name].progress++;
      } else if (info.task.type === 'REDUCING') {
        _this.executions[info.task.execution.name].time.reducing +=
          info.elapsedTime;
      }
    }

    _this.clearTaskTimeout(info.task.name);
    delete _this.taskTimeouts[info.task.name];

    _this.resolveFinishTask(info);
  } else if (info.type === 'FETCHING') {
    if (_this.executions[info.executionName]) {
      _this.executions[info.executionName].time.fetching += info.elapsedTime;
    }
    _this._appendCachedWorker(info.workerName, info.cachedSessions);

    _this.resolveFinishFetching(info);
  }
};

Master.prototype._dispatchFailed = function _dispatchFailed(info) {
  var _this = this;

  _this.clearTaskTimeout(info.taskName);
  delete _this.taskTimeouts[info.taskName];

  _this.scheduler.dispatchFailed(info);

  _this.resolveFailed(info);
};

/**
 * Session / Execution management
 */

Master.prototype.createSession = function createSession(options, token) {
  var sessionName = 'session' + this.getId();

  this.sessions[sessionName] = {
    name: sessionName,
    resources: options.resources,
    tokens: {},
    producer: options.producer,
    format: options.format,
    cachedWorkers: [],
    executionNames: [],
    updates: [],
    userName: this._getUserNameByToken(token),
    running: false
  };

  return this.getSession(sessionName, token);
};

Master.prototype.deleteSession = function deleteSession(sessionName, token) {
  var _this = this;

  if (!_this.sessions[sessionName]) {
    _this.log('Master', 'Deleting invalid session ' + sessionName);
    return { error: 'Deleting invalid session ' + sessionName };
  }

  if (_this.sessions[sessionName].userName !==
      _this._getUserNameByToken(token)) {
    _this.log('Master', 'You are not allowed to delete this session');
    return { error: 'You are not allowed to delete this session' };
  }

  _this.sessions[sessionName].executionNames.map(function(executionName) {
    delete _this.executions[executionName];
  });

  _this.sessions[sessionName].cachedWorkers.map(function(workerName) {
    _this._deleteSessionCache(workerName, sessionName);
  });

  delete _this.sessions[sessionName];

  return { success: true };
};

Master.prototype._appendCachedWorker =
function _appendCachedWorker(workerName, cachedSessionNames) {
  var _this = this;

  // TODO(peryaudo): these are inefficient

  cachedSessionNames.map(function(cachedSessionName) {
    if (!_this.sessions[cachedSessionName]) {
      return;
    }

    var session = _this.sessions[cachedSessionName];
    if (session.cachedWorkers.indexOf(workerName) < 0) {
      session.cachedWorkers.push(workerName);
    }
  });

  var included = {};
  cachedSessionNames.map(function(cachedSessionName) {
    included[cachedSessionName] = true;
  });

  var filter = function filter(cachedWorkerName) {
    return cachedWorkerName !== workerName;
  };

  for (var sessionName in _this.sessions) {
    if (_this.sessions.hasOwnProperty(sessionName)) {
      var session = _this.sessions[sessionName];
      if (!included[sessionName] &&
          session.cachedWorkers.indexOf(workerName) >= 0) {
        session.cachedWorkers.filter(filter);
      }
    }
  }
};

Master.prototype._deleteSessionCache =
function _deleteSessionCache(workerName, sessionName) {
  var _this = this;

  var worker = _this.workers[workerName];
  if (!worker) {
    _this.log('Master', 'deleteSessionCache from invalid worker ' + workerName);
    return;
  }

  // TODO(peryaudo): delete task result images

  var client = new JsonRpcClient(
      new JsonRpcClientTcp(
        worker.host,
        worker.port,
        { timeout: 10, retries: 0 }));
  client.register('deleteCache');
  client.deleteCache({
    sessionName: sessionName
  }, function() {
    client.shutdown();
  });
};

Master.prototype = concatObject(Master.prototype, executions);

/**
 * Receiving result
 */

Master.prototype.receive = function receive(workerName, taskName) {
  var _this = this;
  var d = Q.defer();

  var worker = _this.workers[workerName];

  // _this.master.log('Master', 'retrieving ...');

  request({
    uri: 'http://' + worker.host + ':' + worker.resourcePort +
      '/results/' + taskName,
    encoding: null
  }, function(error, response, body) {
    if (error) {
      _this.log('Master', error);
      d.reject(error);
    } else {
      // _this.master.log('Master', 'retrieving finished!');
      d.resolve(body);
    }
  });

  return d.promise;
};

Master.prototype.receiveExecutionResult =
function retrieveExecutionResult(executionName, token) {
  var _this = this;
  var d = Q.defer();

  var limitedExecution = _this.getExecution(executionName, token);
  if (limitedExecution.error) {
    d.resolve(limitedExecution);
    return d.promise;
  }

  var execution = _this.executions[executionName];

  if (!execution.last) {
    d.resolve({ error: 'The task is not yet finished' });
    return d.promise;
  }

  _this.receive(execution.last.workerName, execution.last.task.name)
  .then(function(image) {
    d.resolve({
      format: _this.sessions[execution.sessionName].format,
      image: image
    });
  }, function(error) {
    d.resolve({ error: error });
  });

  return d.promise;
};

/**
 * User authentication
 */

Master.prototype.authenticate = function authenticate(userName, password) {
  if (!this.privateKey) {
    this.log(
      'Master',
      'Authentication disabled because private key is not present');
    return {
      error: 'Authentication disabled because private key is not present'
    };
  }

  if (!userName || !password) {
    return { error: 'userName and password are required.' };
  }

  if (this.users[userName] && this.users[userName].password === password) {
    return {
      authToken:jsonwebtoken.sign({ userName: userName }, this.privateKey)
    };
  } else {
    return { error: 'Invalid userName or password.' };
  }
};

Master.prototype._getUserNameByToken = function _getUserNameByToken(authToken) {
  if (!this.privateKey) {
    this.log(
      'Master',
      'Authentication disabled because private key is not present');
    return;
  }

  try {
    return jsonwebtoken.verify(authToken, this.privateKey).userName;
  } catch (error) {
    return;
  }
};

Master.prototype._getTokensByToken = function _getTokensByToken(authToken) {
  var userName = this._getUserNameByToken(authToken);
  if (userName && this.users[userName]) {
    return this.users[userName].tokens;
  } else {
    return {};
  }
};

Master.prototype.registerResourceTokenByToken =
function registerResourceTokenByToken(resourceName, code, authToken) {
  var _this = this;
  var d = Q.defer();

  var userName = _this._getUserNameByToken(authToken);
  if (!userName || !_this.users[userName]) {
    d.resove({ error: 'invalid francine auth token' });
    return d.promise;
  }

  if (!_this.resources[resourceName]) {
    d.resolve({ error: 'invalid resource name' });
    return d.promise;
  }

  _this.resources[resourceName].generateResourceToken(code)
  .then(function(resourceToken) {
    _this.users[userName].tokens[resourceName] = resourceToken;
    d.resolve({ success: true });
  }, function(error) {
    d.resolve({ error: error });
  });

  return d.promise;
};

Master.prototype.getAuthorizeStatus =
function getAuthorizeStatus(resourceName, authToken) {
  var userName = this._getUserNameByToken(authToken);
  if (!userName || !this.users[userName]) {
    return { error: 'invalid francine auth token' };
  }

  if (!this.resources[resourceName]) {
    return { error: 'invalid resource name' };
  }

  return {
    authorizeUrl: this.resources[resourceName].getAuthorizeUrl(),
    authorized: this.users[userName].tokens[resourceName] ? true : false
  };
};

module.exports = Master;
