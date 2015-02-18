'use strict';

var StaticInstanceManager = function (master, number) {
    var self = this;

    self.master = master;
    self.number = number;
};

StaticInstanceManager.prototype.manage = function () {
    var self = this;

    return self.master.resizeWorkers(self.number);
};

module.exports = StaticInstanceManager;
