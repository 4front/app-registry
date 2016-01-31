var appRegistry = require('..');
var assert = require('assert');
var _ = require('lodash');
var sinon = require('sinon');
var shortid = require('shortid');

require('dash-assert');

describe('appRegistry', function() {
  var self;

  beforeEach(function() {
    self = this;

    this.cache = {};
    this.database = {
      apps: [],
      domains: []
    };

    this.settings = {
      cacheEnabled: true,
      sslEnabled: true,
      virtualHost: 'apphost.com',
      cache: {
        get: sinon.spy(function(key, callback) {
          callback(null, self.cache[key]);
        }),
        del: sinon.spy(function(key) {
          delete self.cache[key];
        }),
        setex: sinon.spy(function(key, value) {
          self.cache[key] = value;
        })
      },
      database: {
        getApplication: sinon.spy(function(appId, callback) {
          callback(null, _.find(self.database.apps, {appId: appId}));
        }),
        getApplicationByName: sinon.spy(function(name, callback) {
          callback(null, _.find(self.database.apps, {name: name}));
        }),
        getLegacyDomain: sinon.spy(function(domain, callback) {
          callback(null, _.find(self.database.domains, {domain: domain}));
        })
      }
    };

    this.registry = appRegistry(this.settings);

    this.addToCache = function(app) {
      self.settings.cache.setex('app_' + app.appId, JSON.stringify(app));
      self.settings.cache.setex('app_name_' + app.name, app.appId);
    };
  });

  describe('getById', function() {
    it('app is in cache', function(done) {
      var appId = '123';
      this.addToCache({appId: appId, name: 'appname'});

      this.registry.getById(appId, function(err, app) {
        if (err) return done(err);

        assert.ok(self.settings.cache.get.calledWith('app_' + appId));
        assert.equal(appId, app.appId);
        done();
      });
    });

    it('app not in cache but in database', function(done) {
      var appId = '123';
      var appName = 'appname';
      this.database.apps.push({appId: appId, name: appName});

      this.registry.getById(appId, function(err, app) {
        if (err) return done(err);

        assert.ok(self.settings.cache.get.calledWith('app_' + appId));
        assert.ok(self.settings.database.getApplication.calledWith(appId));
        assert.ok(self.settings.cache.setex.calledWith('app_' + appId));
        assert.ok(self.settings.cache.setex.calledWith('app_name_' + appName));
        assert.equal(appId, app.appId);
        done();
      });
    });

    it('app not in cache and not in database', function(done) {
      var appId = '123';
      this.registry.getById(appId, function(err, app) {
        assert.ok(self.settings.cache.get.calledWith('app_' + appId));
        assert.ok(self.settings.database.getApplication.calledWith(appId));
        assert.ok(_.isNull(app));
        done();
      });
    });

    it('force reload', function(done) {
      var appId = '123';
      this.addToCache({appId: appId, name: 'appname'});
      this.database.apps.push({appId: appId, name: 'appname'});

      this.registry.getById(appId, {forceReload: true}, function(err, app) {
        assert.equal(self.settings.cache.get.called, false);
        assert.ok(self.settings.database.getApplication.calledWith(appId));
        assert.ok(self.settings.cache.setex.calledWith('app_' + appId));
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
        assert.ok(self.settings.cache.get.calledWith('app_name_' + appName));
        assert.ok(self.settings.cache.get.calledWith('app_' + appId));

        assert.equal(appId, app.appId);
        done();
      });
    });

    it('app not in cache but in database', function(done) {
      var appId = '123';
      var appName = 'appname';
      this.database.apps.push({appId: appId, name: appName});

      this.registry.getByName(appName, function(err) {
        assert.ok(self.settings.cache.get.calledWith('app_name_' + appName));
        assert.ok(self.settings.database.getApplicationByName.calledWith(appName));
        assert.ok(self.settings.cache.setex.calledWith('app_name_' + appName));
        assert.ok(self.settings.cache.setex.calledWith('app_' + appId));

        done();
      });
    });
  });

  describe('batchGetById()', function() {
    it('some in cache, some not', function(done) {
      this.database.apps.push({appId: '1', name: 'app1'});
      this.addToCache({appId: '2', name: 'app2'});

      this.registry.batchGetById(['1', '2', '3'], function(err, apps) {
        assert.equal(apps.length, 2);
        assert.ok(self.settings.database.getApplication.calledWith('1'));
        assert.ok(self.settings.database.getApplication.calledWith('3'));
        assert.ok(self.settings.cache.setex.calledWith('app_1'));
        done();
      });
    });
  });

  describe('getByDomain', function() {
    beforeEach(function() {
      self = this;
      this.appId = shortid.generate();
      this.settings.database.getAppIdByDomainName = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, self.appId);
      });

      this.addToCache({appId: this.appId});

      this.settings.database.getLegacyDomain = sinon.spy(function(fullDomainName, callback) {
        callback(null, {domain: fullDomainName, appId: self.appId});
      });
    });

    it('new style domain exists', function(done) {
      this.registry.getByDomain('www.app.com', function(err, app) {
        if (err) return done(err);
        assert.isTrue(self.settings.database.getAppIdByDomainName.calledWith('app.com', 'www'));
        assert.isFalse(self.settings.database.getLegacyDomain.called);
        assert.equal(app.appId, self.appId);
        done();
      });
    });

    it('new style domain does not exist', function(done) {
      this.settings.database.getAppIdByDomainName = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, null);
      });

      this.registry.getByDomain('www.app.com', function(err, app) {
        assert.isTrue(self.settings.database.getAppIdByDomainName.calledWith('app.com', 'www'));
        assert.isTrue(self.settings.database.getLegacyDomain.calledWith('www.app.com'));
        assert.equal(app.appId, self.appId);
        done();
      });
    });

    it('apex domain does not check for new style domain', function(done) {
      this.registry.getByDomain('app.com', function(err, app) {
        assert.isFalse(self.settings.database.getAppIdByDomainName.called);
        assert.isTrue(self.settings.database.getLegacyDomain.calledWith('app.com'));
        assert.equal(app.appId, self.appId);
        done();
      });
    });

    it('no matching new style or legacy domain', function(done) {
      this.settings.database.getAppIdByDomainName = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, null);
      });

      this.settings.database.getLegacyDomain = sinon.spy(function(fullDomainName, callback) {
        callback(null, null);
      });

      this.registry.getByDomain('www.app.com', function(err, app) {
        assert.isTrue(self.settings.database.getAppIdByDomainName.calledWith('app.com', 'www'));
        assert.isTrue(self.settings.database.getLegacyDomain.calledWith('www.app.com'));
        assert.isNull(app);
        done();
      });
    });
  });

  it('add to registry', function() {
    var app = {
      appId: '1',
      name: 'test',
      requireSsl: true
    };

    this.registry.add(app);
    assert.equal(app.url, 'https://test.apphost.com');
  });

  describe('fixUpApp', function() {
    it('sets http app url', function(done) {
      this.addToCache({appId: '1', name: 'app'});

      this.registry.getById('1', function(err, app) {
        assert.equal(app.url, 'https://app.apphost.com');
        done();
      });
    });

    it('uses default virtual host if no custom domain with resolve action', function(done) {
      var domain = {domain: 'www.app.com', action: 'redirect'};
      this.addToCache({appId: '1', name: 'app', domains: [domain]});

      this.registry.getById('1', function(err, app) {
        assert.equal(app.url, 'https://app.apphost.com');
        done();
      });
    });

    it('sets custom domain app url', function(done) {
      var domain = {domain: 'www.app.com', action: 'resolve'};
      this.addToCache({appId: '1', name: 'app', domains: [domain], requireSsl: true});

      this.registry.getById('1', function(err, app) {
        assert.equal(app.url, 'https://www.app.com');
        done();
      });
    });

    it('custom domain when requireSsl is false is http', function(done) {
      var domain = {domain: 'www.app.com', action: 'resolve'};
      this.addToCache({appId: '1', name: 'app', domains: [domain], requireSsl: false});

      this.registry.getById('1', function(err, app) {
        assert.equal(app.url, 'http://www.app.com');
        done();
      });
    });

    it('global ssl setting uses https', function(done) {
      this.registry = appRegistry(_.extend({}, this.settings, {
        forceGlobalHttps: true
      }));

      var appId = '123';
      this.addToCache({appId: appId});

      this.registry.getById(appId, function(err, app) {
        assert.isTrue(/^https\:/.test(app.url));

        done();
      });
    });
  });

  describe('disable cache', function() {
    beforeEach(function() {
      self = this;

      this.registry = appRegistry(_.extend({}, this.settings, {
        cacheEnabled: false
      }));

      this.appId = '123';
      this.appName = 'appname';
      this.database.apps.push({appId: this.appId, name: this.appName});
    });

    it('getById', function(done) {
      this.registry.getById(this.appId, function(err) {
        if (err) return done(err);

        assert.isFalse(self.settings.cache.get.called);
        assert.isFalse(self.settings.cache.setex.called);
        assert.isTrue(self.settings.database.getApplication.calledWith(self.appId));

        done();
      });
    });

    it('getById missing', function(done) {
      this.registry.getById('xyz', function(err, app) {
        if (err) return done(err);

        assert.isNull(app);
        done();
      });
    });

    it('getByName', function(done) {
      this.registry.getByName(this.appName, function(err) {
        if (err) return done(err);

        assert.isFalse(self.settings.cache.get.called);
        assert.isFalse(self.settings.cache.setex.called);
        assert.isTrue(self.settings.database.getApplicationByName.calledWith(self.appName));

        done();
      });
    });

    it('getByName missing', function(done) {
      this.registry.getByName('missing-name', function(err, app) {
        if (err) return done(err);

        assert.isNull(app);
        done();
      });
    });
  });

  it('env specific urls', function(done) {
    var environments = ['production', 'test', 'dev'];
    var registry = appRegistry(_.extend(this.settings, {
      virtualEnvironments: function() {
        return environments;
      }
    }));

    var appId = shortid.generate();
    this.database.apps.push({appId: appId, name: 'test-site', requireSsl: true});

    registry.getById(appId, function(err, app) {
      assert.noDifferences(_.keys(app.urls), environments);
      assert.equal(app.urls.production, 'https://test-site.apphost.com');
      assert.equal(app.urls.test, 'https://test-site--test.apphost.com');
      assert.equal(app.urls.dev, 'https://test-site--dev.apphost.com');
      done();
    });
  });

  it('env specific urls with custom domain', function(done) {
    var domain = {
      action: 'resolve',
      domain: 'site.market.net'
    };

    var environments = ['production', 'test', 'dev'];
    var registry = appRegistry(_.extend(this.settings, {
      virtualEnvironments: function() {
        return environments;
      }
    }));

    var appId = shortid.generate();
    this.database.apps.push({appId: appId, name: 'market', requireSsl: true, domains: [domain]});

    registry.getById(appId, function(err, app) {
      assert.noDifferences(_.keys(app.urls), environments);
      assert.equal(app.urls.production, 'https://site.market.net');
      assert.equal(app.urls.test, 'https://site--test.market.net');
      assert.equal(app.urls.dev, 'https://site--dev.market.net');
      done();
    });
  });
});
