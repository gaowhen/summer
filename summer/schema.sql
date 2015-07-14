drop table if exists entries;
create table entries (
  id integer primary key autoincrement,
  title text not null,
  tag text,
  category text,
  create_time text,
  slug text,
  content text not null,
  status text
);
