var _ = require('lodash');
var async = require('async');
var debug = require('debug')('4front:app-registry');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    cacheTtl: 5 * 60,
    cachePrefix: 'app_',
    useCustomDomains: true
  });

  var exports = {};

  // Get app by id
  exports.getById = function(appId, opts, callback) {
    if (_.isFunction(opts)) {
      callback = opts;
      opts = {};
    }

    var appCacheKey = options.cachePrefix + appId;

    if (opts.forceReload === true)
      return fetchFromDatabase(appId, callback);

    debug("looking up app %s in cache", appId);
    options.cache.get(appCacheKey, function(err, appJson) {
      if (err) return callback(err);

      var app;
      if (appJson) {
        try {
          app = JSON.parse(appJson);
        }
        catch (jsonErr) {
        }

        if (app) {
          fixUpApp(app);
          return callback(null, app);
        }
      }

      fetchFromDatabase(appId, callback);
    });
  };

  exports.batchGetById = function(appIds, opts, callback) {
    if (_.isFunction(opts)) {
      callback = opts;
      opts = {};
    }

    debug("batch get apps %o", appIds);
    async.map(appIds, function(appId, cb) {
      exports.getById(appId, opts, cb);
    }, function(err, apps) {
      if (err) return callback(err);

      callback(null, _.compact(apps));
    });
  };

  // Get the app by name
  exports.getByName = function(name, opts, callback) {
    if (_.isFunction(opts)) {
      callback = opts;
      opts = {};
    }

    debug("looking up app with name: %s", name);
    // Lookup the app name in cache.
    options.cache.get(options.cachePrefix + 'name_' + name, function(err, appId) {
      if (err) return callback(err);

      if (appId)
        return exports.getById(appId, opts, callback);

      // If we didn't find the appName in cache, lookup the app by id.
      options.database.getApplicationByName(name, function(err, app) {
        if (err) return callback(err);

        if (app) {
          debug("found app in database with name: %s", name);
          addToCache(app);
          fixUpApp(app);
        }

        callback(null, app);
      });
    });
  };

  // Flush app from the registry forcing it to reload from the database next time get is called.
  exports.flushApp = function(app) {
    options.cache.del(options.cachePrefix + app.appId);
    options.cache.del(options.cachePrefix + 'name_' + app.name);
  };

  exports.getByDomain = function(domainName, opts, callback) {
    if (_.isFunction(opts)) {
      callback = opts;
      opts = {};
    }

    debug("get domain %s", domainName);
    options.database.getDomain(domainName, function(err, domain) {
      if (err)
        return callback(err);

      if (!domain) {
        debug("domain %s not found", domainName);
        return callback(null, null);
      }

      exports.getById(domain.appId, opts, callback);
    });
  };

  // Add the specified app to the registry.
  exports.add = function(app) {
    fixUpApp(app);
    addToCache(app);
    return app;
  };

  function addToCache(app) {
    debug("writing app %s to cache", app.appId);
    options.cache.setex(options.cachePrefix + app.appId, options.cacheTtl, JSON.stringify(app));
    options.cache.setex(options.cachePrefix + 'name_' + app.name, options.cacheTtl, app.appId);
  };

  function fetchFromDatabase(appId, callback) {
    options.database.getApplication(appId, function(err, app) {
      if (err)
        return callback(err);

      if (!app) {
        debug("cannot find app %s in database", appId);
        return callback(null, null);
      }
      debug("found application %s in database", appId);

      // Store a mapping of appName to appId in cache
      addToCache(app);

      fixUpApp(app);
      callback(null, app);
    });
  };

  function fixUpApp(app) {
    // TODO: Delete this when ready
    if (!app.trafficControlRules)
      app.trafficControlRules = [];
    if (!app.configSettings)
      app.configSettings = [];
    if (!app.authConfig)
      app.authConfig = {type: 'public'};

    // Temporary hack until personal apps are deprecated.
    if (!app.orgId)
      app.environments = ['production'];

    var appUrl = (app.requireSsl === true) ? 'https://' : 'http://';
    if (options.useCustomDomains && _.isArray(app.domains) && app.domains.length)
      appUrl += app.domains[0];
    else
      appUrl += (app.name + '.' + options.virtualHost);

    app.url = appUrl;

    fixConfigSettings(app);
  }

  function fixConfigSettings(app) {
    if (_.isObject(app.configSettings) === false)
      return;

    // TODO: Temporary get configSettings back in the correct format.
    if (app.configSettings._default) {
      var configSettings = [];
      _.each(app.configSettings._default, function(value, key) {
        configSettings.push({
          key: key,
          value: value.value,
          serverOnly: !value.sendToClient
        });
      });

      app.configSettings = configSettings;
    }
  }

  return exports;
};
