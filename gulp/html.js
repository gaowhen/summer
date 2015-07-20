/**
 * Created by gaowhen on 15/7/20.
 */
var gulp = require('gulp')
var config = require('config').gulp

gulp.task('html', function () {
	return gulp.src(config.src.template + '/**/*.html')
			.pipe(gulp.dest(config.dist.template))
})
