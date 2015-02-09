'use strict';

var Q = require('q');

var StaticInstanceManager = function (master, instance, number) {
    var self = this;

    self.master = master;
    self.instance = instance;
    self.number = number;
    self.spawnInterval = 15 * 1000;
};

StaticInstanceManager.prototype.manage = function () {
    var self = this;

    self.master.log('StaticInstanceManager', 'Managing instance...');

    var workers = self.master.getWorkers();
    if (!workers) {
        var d = Q.defer();
        self.master.log('StaticInstanceManager', 'Worker information not available.');
        d.resolve();
        return d.promise;
    }

    var needed = self.number - Object.keys(workers).length;

    var q = Q(); // jshint ignore:line

    var spawning = function (remain) {
        return function () {
            self.master.log('StaticInstanceManager', 'Spawn a new instance. Remaining: ' + remain);
            return self.instance.spawn().delay(self.spawnInterval);
        };
    };

    for (var i = needed; i >= 0; i--) {
        q = q.then(spawning(i));
    }

    q = q.then(function () {
        var d = Q.defer();
        self.master.log('StaticInstanceManager', 'Instance spawn finished.');
        d.resolve();
        return d.promise;
    });

    return q;
};

module.exports = StaticInstanceManager;
