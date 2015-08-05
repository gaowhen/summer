var gulp = require('gulp')
var config = require('config').gulp
var browserify = require('browserify')
var watchify   = require('watchify')
var transform  = require('vinyl-transform')

gulp.task('watchify', function () {
  var options = {
    debug: true,
    paths: ['static/src/js'],
    cache: {},
    packageCache: {},
    fullPaths: true,
    transform: []
  }
  var cache = {}
  var bundler = function (options) {
    return transform(function(filename) {
      console.log(filename + ' was changed')
      if(cache[filename]) {
        return cache[filename].bundle()
      }

      var b = watchify(browserify(filename, options))
      b.on('update', bundle)
      cache[filename] = b
      return b.bundle()
    })
  }

  function bundle() {
    return gulp.src([
      config.src.js + '/**/*.js',
      '!' + config.src.js + '/base.js',
      '!' + config.src.js + '/**/_*.js'
    ])
      .pipe(bundler(options))
      .on('error', function (e) {
        console.log(e.message)
        this.emit('end')
      })
      .pipe(gulp.dest(config.dist.js))
  }

  return bundle()
})