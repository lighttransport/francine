'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;
var fs = require('fs');
var request = require('request');

function CompositorReducer(worker) {
  var _this = this;
  _this.worker = worker;
}

function _retrieve(worker, source) {
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
          d.resolve({
            savedFileName: savedFileName,
            weight: source.weight
          });
        }
      });
    }
  });

  return d.promise;
}

function _save(task, worker) {
  return function(images) {
    var d = Q.defer();

    if (images.length === 0) {
      d.reject('No images to compose (All the sources are dead)');
      return d.promise;
    }

    var spawned = spawn(
      __dirname + '/../../compositor/compositor',
      [
        task.session.format,
        worker.getTemporaryDirectory() + '/results/' + task.name
      ].concat(images.map(function(image) { return image.savedFileName; })));

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

  var weight = 0;

  return Q() // jshint ignore:line
  .then(function() {
    var d = Q.defer();

    var images = [];
    var finished = 0;

    sources.map(function(source) {
      _retrieve(_this.worker, source)
      .then(function(image) {
        images.push(image);
        weight += image.weight;

        finished++;
        if (finished >= sources.length) {
          d.resolve(images);
        }
      }, function(error) {
        _this.worker.log('CompositorReducer', 'continue: ' + error);

        finished++;
        if (finished >= sources.length) {
          d.resolve(images);
        }
      });
    });

    return d.promise;
  })
  .then(_save(task, _this.worker))
  .then(function() {
    var d = Q.defer();
    d.resolve(weight);
    return d.promise;
  });
};

module.exports = CompositorReducer;
