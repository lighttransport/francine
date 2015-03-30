'use strict';

function MinCostFlow(options) {
  this.begin = options.begin;
  this.end = options.end;
  this.n = options.n;

  this.edges = [];
  for (var i = 0; i < options.n; i++) {
    this.edges.push([]);
  }
}

MinCostFlow.prototype.addEdge = function addEdge(options) {
  this.edges[options.from].push({
    to:         options.to,
    capacity:   options.capacity,
    cost:       options.cost,
    reverse:    this.edges[options.to].length,
    isResidual: false
  });

  // Residual edge
  this.edges[options.to].push({
    to:         options.from,
    capacity:   0,
    cost:       -options.cost,
    reverse:    this.edges[options.from].length - 1,
    isResidual: true
  });
};

MinCostFlow.prototype.flow = function flow(/* amount */) {
  var distances = [];
  for (var i = 0; i < this.n; i++) {
    distances.push(Infinity);
  }
};

module.exports = MinCostFlow;
