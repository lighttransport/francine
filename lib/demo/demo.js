'use strict';

var argv = require('optimist').argv;
var express = require('express');
var http = require('http');
var socketio = require('socket.io');
var request = require('request');
var Q = require('q');

var app = express();
var server = http.Server(app);
var io = socketio(server);

if (argv._.length < 4) {
  console.warn('Usage: node lib/demo/demo ' +
    'HOST REST_PORT USER_NAME USER_PASSWORD');
  process.exit(1);
}

var host = argv._[0];
var port = argv._[1];
var userName = argv._[2];
var password = argv._[3];

function Francine(socket) {
  this._socket = socket;
  this._parallel = 4;
}

Francine.prototype.render = function render(view) {
  var _this = this;

  if (!_this.authorized) {
    console.log('render() called but not authorized!');
    return;
  }

  Q() // jshint ignore:line
  .then(function() {
    if (!_this.sessionName) {
      return _this._createSession();
    }
  })
  .then(function() {
    request({
      method: 'POST',
      uri: 'http://' + host + ':' + port +
        '/sessions/' + _this.sessionName + '/executions?block=true',
      encoding: null,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': _this.authToken
      },
      body: JSON.stringify({
        sessionName: _this.sessionName,
        parallel: _this._parallel,
        update: view
      })
    }, function(error, response, body) {
      if (error) {
        console.log(error);
        return;
      }
      _this._socket.emit('updated', new Buffer(body).toString('base64'));
    });
  });
};

Francine.prototype.init = function init() {
  var _this = this;
  return _this._auth()
  .then(function() {
    return _this._getAuthProvider();
  })
  .then(function(authStatus) {
    if (!authStatus.authroized) {
      _this._socket.emit('auth', authStatus.authorizeUrl);
    } else {
      _this.authorized = true;
      _this.render();
    }
  });
};

Francine.prototype.auth = function auth(token) {
  var _this = this;
  return _this._setAuthProvider(token)
  .then(function() {
    _this.authorized = true;
    _this.render();
  }, function() {
    return _this.init();
  });
};

Francine.prototype._auth = function _auth() {
  var _this = this;
  var d = Q.defer();
  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port + '/auth',
    json: true,
    body: {
      userName: userName,
      password: password
    }
  }, function(error, response, body) {
    if (error || body.error) {
      console.log(error || body.error);
      d.reject();
      return;
    }

    _this.authToken = body.authToken;
    d.resolve();
  });
  return d.promise;
};

Francine.prototype._getAuthProvider = function _getAuthProvider() {
  var _this = this;
  var d = Q.defer();
  request({
    method: 'GET',
    uri: 'http://' + host + ':' + port + '/auth/dropbox',
    headers: {
      'X-API-Token': _this.authToken
    },
    json: true
  }, function(error, response, body) {
    if (error) {
      console.log(error);
      d.reject();
      return;
    }

    d.resolve(body);
  });
  return d.promise;
};

Francine.prototype._setAuthProvider = function _setAuthProvider(code) {
  var _this = this;
  var d = Q.defer();
  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port + '/auth/dropbox',
    json: true,
    headers: {
      'X-API-Token': _this.authToken
    },
    body: {
      code: code
    }
  }, function(error, response, body) {
    if (error || body.error) {
      console.log(error);
      d.reject();
      return;
    }

    d.resolve();
  });

  return d.promise;
};

Francine.prototype._createSession = function _createSession() {
  var _this = this;

  var d = Q.defer();

  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port + '/sessions',
    json: true,
    headers: {
      'X-API-Token': _this.authToken
    },
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
    if (error || body.error) {
      console.log(error || body.error);
      d.reject();
      return;
    }

    _this.sessionName = body.name;

    d.resolve();
  });

  return d.promise;
};

Francine.prototype.close = function close() {
  var _this = this;

  if (!_this.sessionName) {
    return;
  }

  request({
    method: 'DELETE',
    uri: 'http://' + host + ':' + port + '/sessions/' + _this.sessionName,
    json: true
  }, function(error, response, body) {
    // Suppress warning
    error = error;
    response = response;
    body = body;
  });
};

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});

app.get('/client.js', function(req, res) {
  res.sendFile(__dirname + '/client.js');
});

io.on('connection', function(socket) {
  console.log('connected');

  var francine = new Francine(socket);

  francine.init();

  socket.on('auth', function(token) {
    francine.auth(token);
  });

  socket.on('view_changed', function(view) {
    francine.render({
      // jscs:disable
      'view_changed': {
        set: {
          eye: view.eye,
          lookat: view.lookat,
          up: [0, 1, 0],
          fov: 45
        }
      }
      // jscs:enable
    });
  });

  socket.on('disconnect', function() {
    console.log('disconnected');
    francine.close();
  });
});

server.listen(4500, function() {
  console.log('francine demo listening on 4500');
});
