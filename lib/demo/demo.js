/*
 * Francine Demo using Light Transport Engine.
 */
'use strict';

var argv = require('optimist').argv;
var express = require('express');
var http = require('http');
var socketio = require('socket.io');
var request = require('request');
var Q = require('q');
var WebSocket = require('ws');

var app = express();
var server = http.Server(app);
var io = socketio(server);

if (argv._.length < 4) {
  console.warn('Usage: node lib/demo/demo [--usews]' +
    'HOST REST_PORT USER_NAME USER_PASSWORD');
  process.exit(1);
}

var host = argv._[0];
var port = argv._[1];
var userName = argv._[2];
var password = argv._[3];

var usews = argv.usews;

// Resources from Dropbox
var resources = [
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
];

// Class that uses WebSocket API to communicate with francine.

function FrancineWS(socket, parallel) {
  this._socket = socket;
  this._parallel = parallel;
}

FrancineWS.prototype.init = function init() {
  var _this = this;
  _this._ws = new WebSocket('ws://' + host + ':' + port + '/');
  _this._ws.on('open', function() {
    _this._ws.send({
      command: 'auth',
      userName: userName,
      password: password
    });
    _this._ws.send({
      command: 'getAuthorizeStatus',
      resourceName: 'dropbox'
    });
  });
  _this._ws.on('message', function onMessage(message) {
    console.log(JSON.stringify(message));
    if (message.authorizeUrl) {
      _this._socket.emit('auth', message.authorizeUrl);
    }
    if (message.authorized) {
      _this._authorized = true;
    }
    if (message.image) {
      _this._socket.emit('updated', new Buffer(message.image));
    }
    if (message.reducer === 'jpg') {
      _this.sessionName = message.name;
      _this.render();
    }
  });
};

FrancineWS.prototype.auth = function auth(code) {
  this._ws.send({
    command: 'registerResourceToken',
    resourceName: 'dropbox',
    code: code
  });
};

FrancineWS.prototype.render = function render(view) {
  var _this = this;
  if (!_this._authorized) {
    console.log('render() called but not authorized!');
    return;
  }
  if (!_this._sessionName) {
    _this._ws.send({
      command: 'createSession',
      producer: 'lte',
      reducer: 'jpg',
      resources: resources
    });
    return;
  }

  _this.send({
    command: 'createExecution',
    sessionName: _this._sessionName,
    parallel: _this._parallel,
    update: view
  });
};

FrancineWS.prototype.close = function close() {
  var _this = this;

  _this._ws.send({
    command: 'deleteSession',
    sessionName: _this.sessionName
  });

  _this._ws.close();
};

// Class that uses REST API to communicate with francine.
function FrancineRest(socket, parallel) {
  this._socket = socket;
  this._parallel = parallel;
}

FrancineRest.prototype.render = function render(view) {
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

FrancineRest.prototype.init = function init() {
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

FrancineRest.prototype.auth = function auth(token) {
  var _this = this;
  return _this._setAuthProvider(token)
  .then(function() {
    _this.authorized = true;
    _this.render();
  }, function() {
    return _this.init();
  });
};

FrancineRest.prototype._auth = function _auth() {
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

FrancineRest.prototype._getAuthProvider = function _getAuthProvider() {
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

FrancineRest.prototype._setAuthProvider = function _setAuthProvider(code) {
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

FrancineRest.prototype._createSession = function _createSession() {
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
      resources: resources
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

FrancineRest.prototype.close = function close() {
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

  var francine;
  if (usews) {
    francine = new FrancineWS(socket, /* parallel = */ 4);
  } else {
    francine = new FrancineRest(socket, /* parallel = */ 4);
  }

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
