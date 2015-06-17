'use strict';

var fs = require('fs');

// Base class for Master, Worker and Deployer
function Runner(argv) {
  var attrs = {
    instanceType:        argv.instanceType,
    instanceManagerType: argv.instanceManagerType,
    schedulerType:       argv.schedulerType,

    staticInstanceSize:  argv.staticInstanceSize,

    restPort:            argv.restPort,
    port:                argv.port,
    dashboardPort:       argv.dashboardPort,
    resourcePort:        argv.resourcePort,

    configs: {},
    users: {}
  };

  for (var key in attrs) {
    if (attrs.hasOwnProperty(key)) {
      this[key] = attrs[key];
    }
  }
}

// Return false if valid
Runner.prototype.checkAndDefault = function checkAndDefault() {
  var attrs = {
    instanceType:        'local',
    instanceManagerType: 'static',
    schedulerType:       'queue',

    staticInstanceSize:  4,

    restPort:            3000,
    port:                5000,
    dashboardPort:       4000,
    resourcePort:        9000,

    manageInterval:      15 * 1000,
    waitingPongTimeout:  4,
    statusInterval:      10 * 1000,

    chaos:               0
  };

  for (var key in attrs) {
    if (attrs.hasOwnProperty(key)) {
      this[key] = this[key] || attrs[key];
    }
  }
};

Runner.prototype.log = function log(from, message) {
  console.log('Francine: ' + from + ': ' + message);
};

Runner.prototype.readConfig = function readConfig() {
  var filename = (process.env.HOME || '/root') + '/.francinerc';

  if (!fs.existsSync(filename)) {
    throw 'No .fracinerc available at ' + filename;
  }

  var rc = JSON.parse(
      fs.readFileSync(filename, { encoding: 'utf-8' }));

  this.log('Master', 'Read configuration form ' + filename);

  var attrs = {
    // Configuration for Master
    instanceType:        rc.instanceType,
    instanceManagerType: rc.instanceManagerType,
    schedulerType:       rc.schedulerType,

    staticInstanceSize:  rc.staticInstanceSize,

    privateKey: rc.privateKey,

    gce: rc.gce,

    manageInterval: rc.manageInterval ? rc.manageInterval * 1000 : undefined,
    statusInterval: rc.statusInterval ? rc.statusInterval * 1000 : undefined,

    // Configuration for Worker
    malliePath: rc.malliePath,
    ltePath:    rc.ltePath,

    dropbox: rc.dropbox,

    chaos:                rc.chaos,
    disableZombieDestroy: rc.disableZombieDestroy
  };

  for (var key in attrs) {
    if (attrs.hasOwnProperty(key)) {
      this[key] = this[key] || attrs[key];
    }
  }

  if (rc.users) {
    for (var userName in rc.users) {
      if (rc.users.hasOwnProperty(userName)) {
        this.users[userName] = {
          password: rc.users[userName],
          tokens: {}
        };
      }
    }
  }

  // Only for write back through deployment packager
  this._rc = rc;
};

Runner.prototype.writeBackConfig = function writeBackConfig(filename, attrs) {
  for (var key in attrs) {
    if (attrs.hasOwnProperty(key)) {
      this._rc[key] = attrs[key];
    }
  }

  fs.writeFileSync(
      filename,
      this._rc);
};

Runner.prototype.getClusterInfo = function getClusterInfo() {
  return {
    instanceType: this.instanceType,
    instanceManagerType: this.instanceManagerType,
    staticInstanceSize: this.staticInstanceSize,
    schedulerType: this.schedulerType
  };
};

Runner.prototype.getPort = function getPort() {
  return this.port;
};

Runner.prototype.getRestPort = function getRestPort() {
  return this.restPort;
};

Runner.prototype.getDashboardPort = function getDashboardPort() {
  return this.dashboardPort;
};

Runner.prototype.getResourcePort = function getResourcePort() {
  return this.resourcePort;
};

module.exports = Runner;
