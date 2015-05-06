'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;
var fs = require('fs');
var request = require('request');

function CompositorReducer(worker) {
  var _this = this;
  _this.worker = worker;
}

function _retrieve(worker) {
  return function(source) {
    var d = Q.defer();

    var uri = 'http://' + source.worker.host + ':' +
      source.worker.resourcePort + '/results/' + source.taskName;

    request({
      uri: uri,
      encoding: null
    }, function(error, response, body) {
      if (error) {
        d.reject(source.worker.host + ':' + source.worker.resourcePort + ': ' +
          error.toString());
      } else {
        var savedFileName = worker.getTemporaryDirectory() +
          '/results/' + source.taskName;
        fs.writeFile(savedFileName, body, function(error) {
          if (error) {
            d.reject(error);
          } else {
            d.resolve(savedFileName);
          }
        });
      }
    });

    return d.promise;
  };
}

function _save(task, worker) {
  return function(images) {
    var d = Q.defer();

    var spawned = spawn(
      __dirname + '/../../compositor/compositor',
      [
        task.session.format,
        worker.getTemporaryDirectory() + '/results/' + task.name
      ].concat(images));

    spawned.stdout.on('data', function(data) {
      worker.log('CompositorReducer', data.toString('utf-8'));
    });

    spawned.stderr.on('data', function(data) {
      worker.log('CompositorReducer', data.toString('utf-8'));
    });

    spawned.on('exit', function(code) {
      if (code !== 0) {
        worker.log(
          'CompositorReducer',
          'Returned with non-zero code: ' + code);
        d.reject('Returned with non-zero code: ' + code);
        return;
      }

      d.resolve();
    });

    spawned.on('error', function(error) {
      d.reject(error);
    });

    return d.promise;
  };
}

CompositorReducer.prototype.reduce = function reduce(task) {
  var _this = this;

  var sources = task.execution.tasks;

  return Q.all(sources.map(_retrieve(_this.worker)))
  .then(_save(task, _this.worker));
};

module.exports = CompositorReducer;
