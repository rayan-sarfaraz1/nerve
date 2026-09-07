/* NERVE service worker
   Kaam: (1) game ko offline chalana, (2) Chrome ko "Install app"
   dikhane ke qabil banana. Iske baghair PWA install nahi hota.

   Game update karne ke baad CACHE ka number barha dena, warna
   phone purani copy hi dikhata rahega. */
var CACHE = "nerve-v31-left-column-powers";
var FILES = [
  "./",
  "./index.html",
  "./background/pulse-chamber.png",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./powers/slow-time.png",
  "./powers/shield.png",
  "./powers/double-coins.png",
  "./powers/revive.png"
];

self.addEventListener("install", function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(FILES); })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  if(e.request.method !== "GET") return;
  /* Always refresh the game document so published fixes are not hidden by cache. */
  if(e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request, { cache:"no-store" }).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put("./index.html", copy); });
        return res;
      }).catch(function(){ return caches.match("./index.html"); })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function(hit){
      if(hit) return hit;
      return fetch(e.request).then(function(res){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        return res;
      }).catch(function(){
        return caches.match("./index.html");
      });
    })
  );
});
