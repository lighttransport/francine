'use strict';

// TODO(peryaudo):
//  * Implement automatic cluster spawning
//  * Introduce authentication to francine (to prevent OAuth per session!)

var argv = require('optimist').argv;
var process = require('process');
var request = require('request');
var readline = require('readline');
var exec = require('child_process').exec;
var fs = require('fs');
var Q = require('q');

var iface = readline.createInterface(process.stdin, process.stderr);

var host;
var port;

function retrieveClusterInfo() {
  var d = Q.defer();
  request({
    method: 'GET',
    uri: 'http://' + host + ':' + port + '/info',
    json: true
  }, function(error, response, body) {
    if (error) {
      d.reject(error);
      return;
    }

    console.log(JSON.stringify(body, null, 4));

    d.resolve();
  });
  return d.promise;
}

function waitForFinish(execution, d) {
  d = d || Q.defer();

  request({
    method: 'GET',
    uri: 'http://' + host + ':' + port +
      '/sessions/' + execution.sessionName + '/executions/' + execution.name,
    json: true
  }, function(error, response, body) {
    if (error) {
      d.reject(error);
      return;
    }

    if (body.error) {
      d.reject(body.error);
    }

    if (body.finished) {
      d.resolve(body);
    } else {
      Q() // jshint ignore:line
      .delay(500).then(function() {
        waitForFinish(body, d);
      });
    }
  });

  return d.promise;
}

function setupMallie() {
  var d = Q.defer();
  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port + '/sessions',
    json: true,
    body: {
      producer: 'mallie',
      format: 'png',
      resources: [
        {
          type: 'dropbox',
          path: '/mallie/data/config.json',
          dst: 'config.json'
        },
        {
          type: 'dropbox',
          path: '/mallie/data/SportsCar.eson',
          dst: 'SportsCar.eson'
        },
        {
          type: 'dropbox',
          path: '/mallie/data/SportsCar.eson.json',
          dst: 'SportsCar.eson.json'
        },
        {
          type: 'dropbox',
          path: '/mallie/data/multi-area-light_Ref.hdr',
          dst: 'multi-area-light_Ref.hdr'
        }
      ]
    }
  }, function(error, response, body) {
    if (error) {
      d.reject(error);
      return;
    }
    d.resolve(body);
  });

  return d.promise;
}

function setupLte() {
  var d = Q.defer();
  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port + '/sessions',
    json: true,
    body: {
      producer: 'lte',
      format: 'jpg',
      resources: [
        {
          type: 'dropbox',
          path: '/lteteapot/raytrace.c',
          dst: 'raytrace.c'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/shaders.json',
          dst: 'shaders.json'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/teapot_scene.json',
          dst: 'teapot_scene.json'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/teapot.json',
          dst: 'teapot.json'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/teapot.material.json',
          dst: 'teapot.material.json'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/teapot.mesh',
          dst: 'teapot.mesh'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/texture.c',
          dst: 'texture.c'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/shader.h',
          dst: 'shader.h'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/light.h',
          dst: 'light.h'
        }
      ]
    }
  }, function(error, response, body) {
    if (error) {
      d.reject(error);
      return;
    }
    d.resolve(body);
  });

  return d.promise;
}

function execute(session, parallel) {
  return function() {
    var d = Q.defer();
    request({
      method: 'POST',
      uri: 'http://' + host + ':' + port +
        '/sessions/' + session.name + '/executions',
      json: true,
      body: {
        sessionName: session.name,
        parallel: parallel
      }
    }, function(error, response, body) {
      if (error) {
        d.reject(error);
        return;
      }
      d.resolve(body);
    });
    return d.promise;
  };
}

function saveExecution(session) {
  return function(execution) {
    var d = Q.defer();
    request({
      uri: 'http://' + host + ':' + port +
        '/sessions/' + session.name +
        '/executions/' + execution.name + '/result',
      method: 'GET',
      encoding: null
    }, function(error, response, body) {
      if (error) {
        d.reject(error);
      } else {
        var filename = '/tmp/' + execution.name + '.png';
        fs.writeFileSync(filename, body);
        exec('open \'' + filename + '\'');

        d.resolve(execution);
      }
    });

    return d.promise;
  };
}

function deleteExecution(session) {
  return function(execution) {
    var d = Q.defer();
    request({
      method: 'DELETE',
      uri: 'http://' + host + ':' + port +
        '/sessions/' + session.name + '/executions/' + execution.name,
      json: true
    }, function(error, response, body) {
      if (error) {
        d.reject(error);
        return;
      }
      d.resolve(body);
    });
    return d.promise;
  };
}

function deleteSession(session) {
  return function() {
    var d = Q.defer();
    request({
      method: 'DELETE',
      uri: 'http://' + host + ':' + port + '/sessions/' + session.name,
      json: true
    }, function(error, response, body) {
      if (error) {
        d.reject(error);
        return;
      }
      d.resolve(body);
    });
    return d.promise;
  };
}

function sep() {
  console.log(
    '----------------------------------------' +
    '----------------------------------------');
}

function sepd() {
  console.warn(
    '========================================' +
    '========================================');
}

function setupAndExecute(setupFn, repeat, parallel) {
  return function() {
    console.log('Parallel = ' + parallel);

    return Q() // jshint ignore:line
    .then(setupFn)
    .then(function(session) {
      var d = Q.defer();
      sepd();
      console.warn('Open browser and authenticate Dropbox at:');
      var authUrl = 'http://' + host + ':' + port +
        '/oauth2/dropbox?sessionName=' + session.name;
      console.warn('  ' + authUrl);
      exec('open \'' + authUrl + '\'');
      iface.question('Press enter to continue ...', function() {
        sepd();
        d.resolve(session);
      });
      return d.promise;
    })
    .then(function(session) {
      var p = Q(); // jshint ignore:line

      console.log('\tFetch\tProduce\tReduce\tTotal');

      var times = [];

      function resultExecution(index) {
        return function(execution) {
          var time = execution.time;
          times.push(time);

          console.log((index + 1) + ':\t' +
            time.fetching + '\t' + time.producing + '\t' +
            time.reducing + '\t' + time.total);
          return execution;
        };
      }

      function getMean(ary) {
        var sum = 0;
        for (var i = 0; i < ary.length; i++) {
          sum += ary[i];
        }
        return (sum / ary.length).toFixed(1);
      }

      function getMedian(ary) {
        return (ary.sort()[(ary.length / 2) | 0]).toFixed(1);
      }

      function printMeanAndMedian() {
        var fetchings = times.map(function(time) { return time.fetching; });
        var producings = times.map(function(time) { return time.producing; });
        var reducings = times.map(function(time) { return time.reducing; });
        var totals = times.map(function(time) { return time.total; });

        console.log('Mean\t' +
          getMean(fetchings) + '\t' + getMean(producings) + '\t' +
          getMean(reducings) + '\t' + getMean(totals));

        console.log('Median\t' +
          getMedian(fetchings) + '\t' + getMedian(producings) + '\t' +
          getMedian(reducings) + '\t' + getMedian(totals));
      }

      for (var i = 0; i < repeat; i++) {
        p = p.then(execute(session, parallel));
        p = p.then(waitForFinish);
        p = p.then(resultExecution(i));
        p = p.then(saveExecution(session));
        p = p.then(deleteExecution(session));
      }
      p = p.then(printMeanAndMedian);

      p = p.then(deleteSession(session));

      p.done();
      return p;
    });
  };
}

function variate(setupFn, exp) {
  return function() {
    var p = Q(); // jshint ignore:line

    function _footer() {
      console.log('');
    }

    for (var i = 0; i < exp; i++) {
      p = p.then(setupAndExecute(setupFn, 10, (1 << i)));
      p = p.then(_footer);
    }

    return p;
  };
}

Q() // jshint ignore:line
.then(function() {
  if (argv._.length < 2) {
    console.warn('Usage: node lib/benchmark/benchmark HOST REST_PORT');
    process.exit(1);
  }

  host = argv._[0];
  port = argv._[1];
})
.then(function() {
  console.log('### Francine Benchmark Report');
  console.log();
  console.log('Starting time: ' + new Date().toString());
  console.log();
  console.log('Benchmarking Francine on ' + host + ':' + port);
  console.log();
  console.log('Cluster configuration:');
})
.then(retrieveClusterInfo)
.then(function() {
  sep();
  console.log(' Benchmarking Mallie ... ');
  sep();
})
// .then(variate(setupMallie, 5))
.then(setupAndExecute(setupMallie, 10, 32))
.then(function() {
  sep();
  console.log(' Benchmarking Lte ... ');
  sep();
})
// .then(variate(setupLte, 10))
// .then(setupAndExecute(setupLte, 10, 32))
.then(function() {
  sep();
  console.log('Finishing time: ' + new Date().toString());
  process.exit(0);
})
.then(null, function(error) {
  console.log(error.toString());
});
