#include "masterlist.h"
#include <cassert>
#include <array>
#include <cstdio>
using namespace frostmod::masterlist;
std::array<uint8_t, 0xe0> entry(uint8_t ip) {
    std::array<uint8_t, 0xe0> raw{};
    raw[kEntryAddr+10]=raw[kEntryAddr+11]=255;
    raw[kEntryAddr+12]=203; raw[kEntryAddr+13]=0;
    raw[kEntryAddr+14]=113; raw[kEntryAddr+15]=ip;
    raw[kEntryPort]=0xd3; raw[kEntryPort+1]=0xc2;
    return raw;
}
int main() {
    ObservedRows cache(1000, 3);
    auto a=entry(1), b=entry(2), c=entry(3), d=entry(4);
    cache.Observe(a.data(), a.size(), "First batch", 100);
    cache.Observe(b.data(), b.size(), "Second batch", 200);
    assert(cache.Snapshot(300).size()==2); // Earlier batch survives.
    cache.Observe(a.data(), a.size(), "Updated name", 400);
    assert(cache.Snapshot(500).size()==2);
    assert(cache.Snapshot(500)[0].name=="Updated name");
    cache.Observe(c.data(), c.size(), "Third", 500);
    cache.Observe(d.data(), d.size(), "Fourth", 600);
    auto rows=cache.Snapshot(700);
    assert(rows.size()==3);
    for(const auto& row:rows) assert(row.name!="Second batch"); // Oldest evicted.
    assert(cache.Snapshot(1400).size()==2); // Expiry is per entry, not last file write.
    assert(cache.Snapshot(1600).empty());
    cache.Observe(nullptr, 0, "Invalid", 1800);
    assert(cache.Snapshot(1800).empty());
    std::puts("masterlist cache: batches, deduplication, bounds and expiry passed");
}
