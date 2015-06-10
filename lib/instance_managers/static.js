'use strict';

function StaticInstanceManager(master, number) {
  this.master = master;
  this.number = number;
}

StaticInstanceManager.prototype.manage = function manage() {
  return this.master.resizeWorkers(this.number);
};

module.exports = StaticInstanceManager;
