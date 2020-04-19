var data = self.data;

var tiffData = data.data
if(data.name.endsWith('.gz')){
  tiffData = pako.inflate(tiffData)
}

var ifds = UTIF.decode(tiffData);
UTIF.decodeImage(tiffData, ifds[0])
var image  = UTIF.toRGBA8(ifds[0]);  // Uint8Array with RGBA pixels
self.res = { image: image, width: ifds[0].width, height: ifds[0].height };