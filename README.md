# Summer

Just another static site generator, view more on [https://www.staticgen.com/](https://www.staticgen.com/)

### virtual env

`source venv/bin/activate`

### npm dependencies

`npm i`

### python packages

`make pip`

### markdown files

put all markdown files into summer/post folder, draft markdown files into summer/_draft folder 

### database

init database: `make initdb`

save entry data: `make fillup`

### config

set site name and subtitle in summer/config.py

and do not forget to replace your own analytics code in fe/js/_ga.js

### boot

`honcho start` 

and it's on [http://127.0.0.1:5000](http://127.0.0.1:5000)

### build

The build button is in page header, all files are exported to ghpages folder
