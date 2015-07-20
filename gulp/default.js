/**
 * Created by gaowhen on 15/7/10.
 */

var gulp = require('gulp')
var serve = require('./serve')
var watch = require('./watch')

gulp.task('default', ['serve', 'watch'])
