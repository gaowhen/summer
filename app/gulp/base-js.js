var gulp = require('gulp')
var config = require('config').gulp
var include = require('gulp-include')

gulp.task('base-js', function () {
  return gulp.src([config.src.js + '/base.js'])
    .pipe(include())
    .pipe(gulp.dest(config.dist.js))
})