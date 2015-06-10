'use strict';

function TwoStateInstanceManager(master, number) {
  this.master = master;
  this.number = number;
}

TwoStateInstanceManager.prototype.manage = function manage() {
  if (this.getLastTaskRequestTime() - Date.now() > 10 * 60 * 1000) {
    return this.master.resizeWorkers(1);
  } else {
    return this.master.resizeWorkers(this.number);
  }
};

module.exports = TwoStateInstanceManager;
