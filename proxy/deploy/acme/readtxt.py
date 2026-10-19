import socket, struct, sys, random

# Read a TXT record for a name from AliDNS (223.5.5.5) with raw DNS UDP.
# Usage: python3 readtxt.py _acme-challenge.api.example.com

name = sys.argv[1]
server = "223.5.5.5"
tid = random.randint(0, 65535)
q = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
for label in name.split("."):
    q += bytes([len(label)]) + label.encode()
q += b"\x00" + struct.pack(">HH", 16, 1)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(4)
s.sendto(q, (server, 53))
data, _ = s.recvfrom(4096)
ancount = struct.unpack(">H", data[6:8])[0]
i = 12
while data[i] != 0:
    if data[i] & 0xC0:
        i += 1
        break
    i += data[i] + 1
i += 5


def readname(d, p):
    parts = []
    while True:
        l = d[p]
        if l & 0xC0:
            ptr = struct.unpack(">H", d[p:p + 2])[0] & 0x3FFF
            parts.append(readname(d, ptr)[0])
            p += 2
            break
        p += 1
        if l == 0:
            break
        parts.append(d[p:p + l].decode())
        p += l
    return ".".join(parts), p


for _ in range(ancount):
    _, i = readname(data, i)
    rtype, rclass, ttl, rdlen = struct.unpack(">HHIH", data[i:i + 10])
    i += 10
    rdata = data[i:i + rdlen]
    i += rdlen
    if rtype == 16:
        txt = b""
        j = 0
        while j < len(rdata):
            ln = rdata[j]
            txt += rdata[j + 1:j + 1 + ln]
            j += 1 + ln
        print(txt.decode())
