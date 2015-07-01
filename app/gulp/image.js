var gulp = require('gulp')
var config = require('config').gulp

gulp.task('image', function () {
	console.log('gulp image')
  return gulp.src(config.src.img + '/**/*.+(png|gif|jpg|eot|woff|ttf|svg|ico)')
    .pipe(gulp.dest(config.dist.img))
})