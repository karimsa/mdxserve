# A nested page

This file lives two folders deep, at `example/nested/deep/05-nested-page.md`. It's here to
show how `mdxserve` handles folder navigation.

When you browse into `nested/`, then `nested/deep/`, the directory listing at each level shows
just that folder's contents — subfolders and Markdown/MDX files. Rendered pages like this one
also show a breadcrumb trail (`example / nested / deep / 05-nested-page.md`) so you can jump
back up to any parent folder without using the browser's back button.

Relative links work the same way they do anywhere else in Markdown. For example, here's a link
back to [the example README](../../README.md), which walks up two levels from this file's
folder.
