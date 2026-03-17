#! /bin/bash

shopt -s globstar nullglob extglob

# print shellcheck version so we know what Github uses
shellcheck -V

# SC1091 - Don't complain about not being able to find files that don't exist.
shellcheck --exclude=SC1091 \
           ./setup/pi/setup-teslausb \
           ./pi-gen-sources/00-teslausb-tweaks/files/rc.local \
           ./run/archiveloop \
           ./run/auto.teslausb \
           ./run/awake_start \
           ./run/awake_stop \
           ./run/mountimage \
           ./run/mountoptsforimage \
           ./run/remountfs_rw \
           ./run/send-push-message \
           ./run/temperature_monitor \
           ./run/waitforidle \
           ./run/shuffle-lockchime.sh \
           ./teslausb-www/html/cgi-bin/check-ffmpeg.sh \
           ./teslausb-www/html/cgi-bin/cleanmeta.sh \
           ./teslausb-www/html/cgi-bin/convert.sh \
           ./teslausb-www/html/cgi-bin/flush-gadget.sh \
           ./teslausb-www/html/cgi-bin/rename.sh \
           ./teslausb-www/html/cgi-bin/savemeta.sh \
           ./teslausb-www/html/cgi-bin/shuffle-config.sh \
           ./teslausb-www/html/cgi-bin/soundinfo.sh \
           ./teslausb-www/html/cgi-bin/soundpack-import.sh \
           ./teslausb-www/html/cgi-bin/trim.sh
