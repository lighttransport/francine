'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;
var fs = require('fs');
var jayson = require('jayson');

function LteProducer(worker, ltePath) {
  this.worker = worker;
  this.ltePath = ltePath;
  this.processes = {};
  this.portCount = 10000 + (worker.getResourcePort() % 10) * 1000;
}

LteProducer.prototype._spawn = function _spawn(task) {
  var _this = this;
  return function() {
    var d = Q.defer();

    var sessionName = task.session.name;

    _this.worker.log('LteProducer', 'Seed: ' + task.seed.toString());
    
    _this.portCount++;

    var args = [
        '--seed=' + task.seed.toString(),
        '--use_jsonrpc=1',
        '--jsonrpc_port=' + _this.portCount,
        'teapot.json'
    ];
    
    var cwd = _this.worker.getTemporaryDirectory() + '/executions/' +
      task.execution.name;


    _this.worker.log('LteProducer', 'Args: ' + args);
    _this.worker.log('LteProducer', 'Cwd: ' + cwd);

    var spawned = spawn(
      _this.ltePath + '/lte', args,
      { cwd: cwd });

    spawned.stdout.on('data', function(data) {
      _this.worker.log('LteProducer', data.toString('utf-8'));
    });

    spawned.stderr.on('data', function(data) {
      _this.worker.log('LteProducer', data.toString('utf-8'));
    });

    spawned.on('exit', function(code) {
      if (code !== 0) {
        _this.worker.log(
          'LteProducer',
          'Returned with non-zero code: ' + code);
        d.reject('Returned with non-zero code: ' + code);
        return;
      }
    });

    spawned.on('error', function(error) {
      d.reject(error);
    });

    _this.processes[sessionName] = {};
    _this.processes[sessionName].spawned = spawned;
    _this.processes[sessionName].appliedUpdates = 0;
    _this.processes[sessionName].client = jayson.client.http({
      hostname: 'localhost',
      port: _this.portCount
    });

    setTimeout(function() {
      d.resolve();
    }, 3 * 1000);

    return d.promise;
  };
};

LteProducer.prototype._sendUpdate = function _sendUpdate(sessionName, update) {
  var _this = this;
  return function() {
    var d = Q.defer();
    _this.processes[sessionName].client.request(
      'update',
      update,
      function(err, error) {
        if (err) {
          d.reject(err);
          return;
        }
        if (error) {
          d.reject(error);
          return;
        }
        d.resolve();
      });
    return d.promise;
  };
};

LteProducer.prototype.produce = function produce(task) {
  var _this = this;
  var d = Q.defer();

  var sessionName = task.session.name;

  var p = Q(); // jshint ignore:line

  if (!_this.processes[sessionName]) {
    p = p.then(_this._spawn(task));
  }

  p = p.then(function() {
    var p = Q(); // jshint ignore:line

    for (var i = _this.processes[sessionName].appliedUpdates;
         i < task.session.updates.length; i++) {
      p = p.then(_this._sendUpdate(sessionName, task.session.updates[i]));
    }

    return p;
  });
  p = p.then(function() {
    var d = Q.defer();
    _this.processes[sessionName].client.request(
      'render',
      [],
      function(err, error, response) {
        if (err) {
          d.reject(err);
          return;
        }
        if (error) {
          d.reject(error);
          return;
        }
        // jscs:disable
        d.resolve(response.image_data); // jshint ignore:line
        // jscs:enable
      }
    );
    return d.promise;
  });
  p = p.then(function(image) {
    fs.writeFileSync(
      _this.worker.getTemporaryDirectory() + '/results/' + task.name,
      new Buffer(image.split(',')[1], 'base64'));

    d.resolve();
  });

  p.done(null, function(err) {
    d.reject(err);
  });

  return d.promise;
};

LteProducer.prototype.deleteCache = function deleteCache(sessionName) {
  this.processes[sessionName].spawned.kill();
  delete this.processes[sessionName];
  return sessionName;
};

module.exports = LteProducer;
