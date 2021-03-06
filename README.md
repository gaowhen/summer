# Summer

Just another static site generator, mainly for myself to learn python. 

View the online site. [GaoWhen高H温](http://gaowhen.com)

There are more generators on [https://www.staticgen.com/](https://www.staticgen.com/)

### npm dependencies

`npm i`

### python packages

`make pip`

### markdown files

create summer/post/ summer/_draft/ folder 

and put all markdown files into summer/post/ folder, draft markdown files into summer/_draft/ folder 

### ghpage repo

crete ghpages, ghpages/post/, ghpages/page/, ghpages/static/ folders

git init add remote origin as your own ghpage repo uri

for example:

my own repo uri is `https://github.com/gaowhen/gaowhen.github.io.git`

  git remote add origin https://github.com/gaowhen/gaowhen.github.io.git

### database

init database: `make initdb`

save entry data: `make fillup`

### config

set site name and subtitle in summer/config.py

and do not forget to replace your own analytics code in fe/js/_ga.js

### boot

use [honcho](https://github.com/nickstenning/honcho) to control dev enviroment

`honcho start` 

and it's on [http://127.0.0.1:5000](http://127.0.0.1:5000)

### build

The build button is in page header, all files are exported to ghpages folder

### deploy

The deploy button is in page header, next to build button. 

Just remember to add your github repo uri to summery/config.py 

### MIT license

Copyright (c) 2015 Miko Gao <gaowhen.com@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
