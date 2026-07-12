#!/usr/bin/env liquidsoap

settings.log.file := false
settings.log.stdout := true
settings.log.level := 4

primary_live = ref(false)
guest_live   = ref(false)

def write_live_status() =
  file.write(data='{"primary": #{primary_live()}, "guest": #{guest_live()}}',
             "/recordings/.live-status.json")
end

def set_live(r, v) =
  r := v
  write_live_status()
end

harbor_password = environment.get("HARBOR_PASSWORD")
if harbor_password == "" then
  log.severe("HARBOR_PASSWORD is not set!")
end

# Main inputs from source
primary_in = input.harbor("primary", port=9000, password=harbor_password, icy=true,
                          on_connect=fun (_) -> set_live(primary_live, true),
                          on_disconnect={set_live(primary_live, false)})

guest_in   = input.harbor("guest",   port=9000, password=harbor_password, icy=true,
                          on_connect=fun (_) -> set_live(guest_live, true),
                          on_disconnect={set_live(guest_live, false)})

clock.assign_new(id="harbor", [primary_in, guest_in])

primary = buffer(buffer=2.0, max=10.0, fallible=true, primary_in)
guest   = buffer(buffer=2.0, max=10.0, fallible=true, guest_in)


live = add(normalize=false, [primary, guest])
live = insert_metadata(live)

def forward_meta(m) =
  title  = m["title"]
  artist = m["artist"]
  song   = m["song"]
  if title != "" or artist != "" or song != "" then
    print("live metadata -> #{artist} - #{title}, song: #{song}")
    live.insert_metadata(m)
  end
end

primary.on_metadata(synchronous=true, forward_meta)
guest.on_metadata(synchronous=true, forward_meta)

live = limiter(live)

rec_dir      = "/recordings"
incoming_dir = "#{rec_dir}/incoming"
disable_flag = "#{rec_dir}/.recording-disabled"

if not file.exists(incoming_dir) then file.mkdir(incoming_dir) end

write_live_status()

to_record = switch(track_sensitive=false,
                   [({not file.exists(disable_flag)}, live)])

def finalize_recording(fname) =
  base = path.basename(fname)
  if file.exists(fname) then
    if file.size(fname) < 120000 then
      log.important("recorder: discarding tiny file #{base}")
      file.remove(fname)
    else
      log.important("recorder: finished #{base}")
      file.move(fname, "#{rec_dir}/#{base}")
    end
  end
end

output.file(
  %mp3(bitrate=192),
  fallible=true,
  on_close=finalize_recording,
  {time.string("#{incoming_dir}/show_%Y-%m-%d_%H-%M-%S.mp3")},
  to_record
)

holding = playlist(mode="randomize", reload_mode="watch", "/music")


fade_dur = 1.0
def smooth(old, new) =
  add(normalize=false, [
    fade.out(duration=fade_dur, old),
    fade.in(duration=fade_dur, new)
  ])
end

radio = fallback(
  track_sensitive=false,
  transitions=[smooth, smooth],
  [live, holding]
)

radio = mksafe(radio)

icecast_password = environment.get("ICECAST_SOURCE_PASSWORD")
if icecast_password == "" then
  log.severe("ICECAST_SOURCE_PASSWORD is not set - icecast outputs will fail to connect")
end

output.icecast(
  %opus(bitrate=256, channels=2, signal="music", complexity=10),
  host="icecast",
  port=8000,
  password=icecast_password,
  mount="stream.ogg",
  name="MBS Radio",
  description="You are listening to MBS Radio! A PBC and Global Affairs Pixl Digital Service.",
  genre="Various",
  radio
)

output.icecast(
  %mp3(bitrate=320),
  host="icecast",
  port=8000,
  password=icecast_password,
  mount="stream.mp3",
  name="MBS Radio",
  description="You are listening to MBS Radio! A PBC and Global Affairs Pixl Digital Service.",
  genre="Various",
  radio
)
