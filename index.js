var _ = require('lodash');
var async = require('async');
var debug = require('debug')('4front:app-registry');

module.exports = function(settings) {
  settings = _.defaults({}, settings || {}, {
    cacheTtl: 5 * 60,
    cachePrefix: 'app_',
    useCustomDomains: true,
    forceGlobalHttps: false,
    cacheEnabled: process.env.FF_APP_CACHE_ENABLED === '1'
  });

  var exports = {};

  // Get app by id
  exports.getById = function(appId, opts, callback) {
    if (_.isFunction(opts)) {
      callback = opts;
      opts = {};
    }

    if (opts.forceReload === true || settings.cacheEnabled !== true) {
      return fetchFromDatabase(appId, callback);
    }

    debug('looking up app %s in cache', appId);
    var appCacheKey = settings.cachePrefix + appId;

    settings.cache.get(appCacheKey, function(err, appJson) {
      if (err) return callback(err);

      var app;
      if (appJson) {
        try {
          app = JSON.parse(appJson);
        } catch (jsonErr) {
          debug('cache object invalid', appCacheKey);
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

    debug('batch get apps %o', appIds);
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

    debug('looking up app with name: %s', name);
    if (opts.forceReload === true || settings.cacheEnabled !== true) {
      settings.database.getApplicationByName(name, function(err, app) {
        if (err) return callback(err);

        if (!app) return callback(null, null);

        fixUpApp(app);
        callback(null, app);
      });
    } else {
      // Lookup the app name in cache.
      settings.cache.get(settings.cachePrefix + 'name_' + name, function(err, appId) {
        if (err) return callback(err);

        if (appId) return exports.getById(appId, opts, callback);

        // If we didn't find the appName in cache, lookup the app by id.
        settings.database.getApplicationByName(name, function(_err, app) {
          if (_err) return callback(_err);

          if (app) {
            debug('found app in database with name: %s', name);

            if (settings.cacheEnabled === true) addToCache(app);

            fixUpApp(app);
          }

          callback(null, app);
        });
      });
    }
  };

  // Flush app from the registry forcing it to reload from the database next time get is called.
  exports.flushApp = function(app) {
    settings.cache.del(settings.cachePrefix + app.appId);
    settings.cache.del(settings.cachePrefix + 'name_' + app.name);
  };

  exports.getByDomain = function(domainName, opts, callback) {
    if (_.isFunction(opts)) {
      callback = opts;
      opts = {};
    }

    debug('get domain %s', domainName);
    async.waterfall([
      function(cb) {
        settings.database.getDomain(domainName, cb);
      },
      function(domain, cb) {
        if (!domain) {
          debug('domain %s not found', domainName);
          return cb(null, null);
        }

        exports.getById(domain.appId, opts, function(err, app) {
          if (err) return cb(err);

          app.domain = domain;
          cb(null, app);
        });
      }
    ], callback);
  };

  // Add the specified app to the registry.
  exports.add = function(app) {
    fixUpApp(app);
    addToCache(app);
    return app;
  };

  // Build the virtual environment url for an app
  function buildEnvUrl(virtualApp, customDomain, envName) {
    // Support env urls for custom domains.
    if (_.isObject(customDomain)) {
      if (envName === 'production') {
        return buildUrl(virtualApp.requireSsl === true, [customDomain.domain]);
      }

      var domainParts = customDomain.domain.split('.');
      if (domainParts.length >= 3) {
        domainParts[0] = domainParts[0] + '--' + envName;
        return buildUrl(virtualApp.requireSsl === true, domainParts);
      }
    } else {
      if (envName === 'production') {
        return buildUrl(virtualApp.requireSsl, [virtualApp.name, settings.virtualHost]);
      }
      return buildUrl(virtualApp.requireSsl, [virtualApp.name + '--' + envName, settings.virtualHost]);
    }

    return buildUrl(virtualApp.requireSsl, [virtualApp.name + '--' + envName, settings.virtualHost]);
  }

  function buildUrl(secure, parts) {
    var url = (secure ? 'https' : 'http') + '://';
    url += parts.join('.');
    return url;
  }

  function addToCache(app) {
    debug('writing app %s to cache', app.appId);
    settings.cache.setex(settings.cachePrefix + app.appId, settings.cacheTtl, JSON.stringify(app));
    settings.cache.setex(settings.cachePrefix + 'name_' + app.name, settings.cacheTtl, app.appId);
  }

  function fetchFromDatabase(appId, callback) {
    settings.database.getApplication(appId, function(err, app) {
      if (err) return callback(err);

      if (!app) {
        debug('cannot find app %s in database', appId);
        return callback(null, null);
      }
      debug('found application %s in database', appId);

      // Store a mapping of appName to appId in cache
      if (settings.cacheEnabled === true) addToCache(app);

      fixUpApp(app);
      callback(null, app);
    });
  }

  function getCustomDomain(virtualApp) {
    if (_.isArray(virtualApp.domains) && virtualApp.domains.length > 0) {
      // Find the first custom domain with a 'resolve' action.
      return _.find(virtualApp.domains, function(domain) {
        return domain.action === 'resolve' || _.isUndefined(domain.action);
      });
    }
    return null;
  }

  function fixUpApp(app) {
    if (!app.trafficControlRules) app.trafficControlRules = [];

    if (_.isFunction(settings.virtualEnvironments)) {
      app.environments = _.union(['production'], settings.virtualEnvironments(app));
    } else {
      app.environments = ['production'];
    }

    if (_.isArray(app.domains) !== true) {
      app.domains = [];
    }

    var customDomain = getCustomDomain(app);

    // If sslEnabled is true and the app is not using a custom domain
    // then force SSL
    if (settings.sslEnabled === true && !_.isObject(customDomain)) {
      app.requireSsl = true;
    }

    app.urls = {};
    _.each(app.environments, function(envName) {
      app.urls[envName] = buildEnvUrl(app, customDomain, envName);
    });

    // For convenience expose the production url on its own property
    app.url = app.urls.production;
  }

  return exports;
};
