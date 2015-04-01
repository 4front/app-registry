var appRegistry = require('..');
var assert = require('assert');
var _ = require('lodash');
var sinon = require('sinon');

describe('appRegistry', function() {
  var self;

  beforeEach(function() {
    self = this;

    this.cache = {};
    this.database = [];

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
          callback(null, _.find(self.database, {appId: appId}));
        }),
        findApplication: sinon.spy(function(criteria, callback) {
          callback(null, _.find(self.database, {name: criteria.name}));
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
      this.database.push({appId: appId, name: appName});

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
      this.database.push({appId: appId, name: 'appname'});

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
      this.database.push({appId: appId, name: appName});

      this.registry.getByName(appName, function(err, app) {
        assert.ok(self.options.cache.get.calledWith('app_name_' + appName));
        assert.ok(self.options.database.findApplication.calledWith({name: appName}));
        assert.ok(self.options.cache.setex.calledWith('app_name_' + appName));
        assert.ok(self.options.cache.setex.calledWith('app_' + appId));

        done();
      });
    });
  });
});
