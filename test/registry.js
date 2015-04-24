var appRegistry = require('..');
var assert = require('assert');
var _ = require('lodash');
var sinon = require('sinon');

describe('appRegistry', function() {
  var self;

  beforeEach(function() {
    self = this;

    this.cache = {};
    this.database = {
      apps: [],
      domains: []
    };

    this.options = {
      appHost: 'apphost.com',
      cache: {
        get: sinon.spy(function(key, callback) {
          callback(null, self.cache[key]);
        }),
        del: sinon.spy(function(key) {
          delete self.cache[key];
        }),
        setex: sinon.spy(function(key, value, ttl) {
          self.cache[key] = value;
        })
      },
      database: {
        getApplication: sinon.spy(function(appId, callback) {
          callback(null, _.find(self.database.apps, {appId: appId}));
        }),
        findApplication: sinon.spy(function(criteria, callback) {
          callback(null, _.find(self.database.apps, {name: criteria.name}));
        }),
        getDomain: sinon.spy(function(domain, callback) {
          callback(null, _.find(self.database.domains, {domain: domain}));
        })
      }
    };

    this.registry = appRegistry(this.options);

    this.addToCache = function(app) {
      self.options.cache.setex('app_' + app.appId, app);
      self.options.cache.setex('app_name_' + app.name, app.appId);
    };
  });

  describe('getById', function() {
    it('app is in cache', function(done) {
      var appId = '123';
      this.addToCache({appId: appId, name: 'appname'});

      this.registry.getById(appId, function(err, app) {
        assert.ok(self.options.cache.get.calledWith('app_' + appId));
        assert.equal(appId, app.appId);
        done();
      });
    });

    it('app not in cache but in database', function(done) {
      var appId = '123';
      var appName = 'appname';
      this.database.apps.push({appId: appId, name: appName});

      this.registry.getById(appId, function(err, app) {
        assert.ok(self.options.cache.get.calledWith('app_' + appId));
        assert.ok(self.options.database.getApplication.calledWith(appId));
        assert.ok(self.options.cache.setex.calledWith('app_' + appId));
        assert.ok(self.options.cache.setex.calledWith('app_name_' + appName));
        assert.equal(appId, app.appId);
        done();
      });
    });

    it('app not in cache and not in database', function(done) {
      var appId = '123';
      this.registry.getById(appId, function(err, app) {
        assert.ok(self.options.cache.get.calledWith('app_' + appId));
        assert.ok(self.options.database.getApplication.calledWith(appId));
        assert.ok(_.isNull(app));
        done();
      });
    });

    it('force reload', function(done) {
      var appId = '123';
      this.addToCache({appId: appId, name: 'appname'});
      this.database.apps.push({appId: appId, name: 'appname'});

      this.registry.getById(appId, {forceReload: true}, function(err, app) {
        assert.equal(self.options.cache.get.called, false);
        assert.ok(self.options.database.getApplication.calledWith(appId));
        assert.ok(self.options.cache.setex.calledWith('app_' + appId));
        assert.equal(appId, app.appId);
        done();
      });
    });
  });

  describe('getByName', function() {
    it('app in cache', function(done) {
      var appId = '123';
      var appName = 'appname';
      this.addToCache({appId: appId, name: appName});

      this.registry.getByName(appName, function(err, app) {
        assert.ok(self.options.cache.get.calledWith('app_name_' + appName));
        assert.ok(self.options.cache.get.calledWith('app_' + appId));

        assert.equal(appId, app.appId);
        done();
      });
    });

    it('app not in cache but in database', function(done) {
      var appId = '123';
      var appName = 'appname';
      this.database.apps.push({appId: appId, name: appName});

      this.registry.getByName(appName, function(err, app) {
        assert.ok(self.options.cache.get.calledWith('app_name_' + appName));
        assert.ok(self.options.database.findApplication.calledWith({name: appName}));
        assert.ok(self.options.cache.setex.calledWith('app_name_' + appName));
        assert.ok(self.options.cache.setex.calledWith('app_' + appId));

        done();
      });
    });
  });

  describe('batchGetById()', function() {
    it('some in cache, some not', function(done) {
      this.database.apps.push({appId: '1', name:'app1'});
      this.addToCache({appId: '2', name:'app2'});

      this.registry.batchGetById(['1', '2', '3'], function(err, apps) {
        assert.equal(apps.length, 2);
        assert.ok(self.options.database.getApplication.calledWith('1'));
        assert.ok(self.options.database.getApplication.calledWith('3'));
        assert.ok(self.options.cache.setex.calledWith('app_1'));
        done();
      });
    });
  });

  describe('getByDomain', function() {
    it('domain exists', function(done) {
      this.addToCache({appId: '1', name:'app'});
      this.database.domains.push({domain: 'www.app.com', appId: '1'});

      this.registry.getByDomain('www.app.com', function(err, app) {
        assert.equal(app.appId, '1');
        done();
      });
    });

    it('domain not exists', function(done) {
      this.registry.getByDomain('www.missing.com', function(err, app) {
        assert.ok(_.isNull(app));
        done();
      });
    });
  });

  it('add to registry', function() {
    var app = {
      appId: '1',
      name: 'test'
    };

    this.registry.add(app);
    assert.equal(app.url, 'http://test.apphost.com');
  });

  describe('fixUpApp', function() {
    it('sets http app url', function(done) {
      this.addToCache({appId: '1', name: 'app'});

      this.registry.getById('1', function(err, app) {
        assert.equal(app.url, 'http://app.apphost.com');
        done();
      })
    });

    it('sets https app url', function(done) {
      this.addToCache({appId: '1', name: 'app', requireSsl: true});

      this.registry.getById('1', function(err, app) {
        assert.equal(app.url, 'https://app.apphost.com');
        done();
      })
    });

    it('sets custom domain app url', function(done) {
      this.addToCache({appId: '1', name: 'app', domains: ['www.app.com'], requireSsl: true});

      this.registry.getById('1', function(err, app) {
        assert.equal(app.url, 'https://www.app.com');
        done();
      })
    });
  });
});
