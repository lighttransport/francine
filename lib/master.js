'use strict';

var express = require('express');

var LocalInstance = require('./instances/local');
var StaticInstanceManager = require('./instance_managers/static');
var QueueScheduler = require('./schedulers/queue');

var Master = function (argv) {
    var self = this;

    self.port = argv.port || 5000;
    self.instanceType = argv.instanceType || 'local';
    self.instanceManagerType = argv.instanceManagerType || 'static';
    self.schedulerType = argv.schedulerType || 'queue';

    self.instance = null;
    self.instanceManager = null;

    self.scheduler = null;

    self.app = null;
};

// This is synchronous method.
Master.prototype.start = function () {
    var self = this;

    // Initialize instance specific object
    self.initializeInstance();

    // Initialize instance manager
    self.initializeInstanceManager();

    // This is asynchronous method.
    self.instanceManager.start();

    // Initialize scheduler
    self.initializeScheduler();

    // Initialize REST API
    self.initializeExpress();

    self.app.listen(self.port, function () {
        console.log('Waiting on port ' + self.port + ' for REST API request...');
    });
};

Master.prototype.initializeInstance = function () {
    var self = this;

    switch (self.instanceType) {
        case 'local':
            self.instance = new LocalInstance();
            break;
    }

    if (!self.instance) {
        console.log('Francine: Error: Invalid worker instance type ' + self.instanceType);
        process.exit(1);
    }

    console.log('Worker instance type: ' + self.instanceType);
};

Master.prototype.initializeInstanceManager = function () {
    var self = this;

    switch (self.instanceManagerType) {
        case 'static':
            self.instanceManager = new StaticInstanceManager(self.instance, self, 4);
            break;
    }

    if (!self.instanceManager) {
        console.log('Francine: Error: Invalid instance manager type ' + self.instanceManagerType);
        process.exit(1);
    }

    console.log('Instance manager type: ' + self.instanceManagerType);
};

Master.prototype.initializeScheduler = function () {
    var self = this;

    switch (self.schedulerType) {
        case 'queue':
            self.scheduler = new QueueScheduler(self.instance, self);
            break;
    }

    if (!self.scheduler) {
        console.log('Francine: Error: invalid scheduler type ' + self.schedulerType);
        process.exit(1);
    }

    console.log('Scheduler type: ' + self.schedulerType);
};

Master.prototype.initializeExpress = function () {
    var self = this;

    self.app = express();

    self.app.get('/', function (req, res) {
        console.log('received request ...');
        var session = self.scheduler.createSession();
        self.scheduler.appendTask(session, {}, function (image, error) {
            if (error) {
                console.log('Francine: Error: ' + error);
                res.end('Francine: Error: ' + error);
            } else {
                res.end(image);
            }

            self.scheduler.deleteSession(session);
        });
    });
};


module.exports = Master;
