// The oracle for the web app's logic test: the iPhone app's own Swift model and search code (chi-eats/ios/ChiRanked:
// Models/Place.swift, Models/Board.swift, Services/Search.swift, Services/DataStore.swift, Services/DataUpdater.swift),
// compiled for macOS with this driver and shim.swift, run on the app's bundled data and on the fixtures. It writes what
// the app shows: every board's order under many filters, every place's fields, searches (exact matches in order, the
// count, Closest matches, how each query parsed), Near me, and the formatters. check_logic.mjs runs logic.js on the same
// data and compares. See ../README.md.
//
// usage: oracle --out <file.json> --tools <playbook/tools/explore> --resources <ChiRanked/Resources> --tests <DataAndSearchTests.swift>
import Foundation

// ------------------------------------------------------------------------------------------------ arguments
var args: [String: String] = [:]
do {
    let a = Array(CommandLine.arguments.dropFirst())
    var i = 0
    while i + 1 < a.count { args[a[i]] = a[i + 1]; i += 2 }
}
func arg(_ k: String) -> String {
    guard let v = args[k] else { FileHandle.standardError.write("missing \(k)\n".data(using: .utf8)!); exit(2) }
    return v
}
let outPath = arg("--out"), toolsDir = arg("--tools"), resDir = arg("--resources"), testsPath = arg("--tests")

func readData(_ path: String) -> Data {
    guard let d = FileManager.default.contents(atPath: path) else { FileHandle.standardError.write("can't read \(path)\n".data(using: .utf8)!); exit(2) }
    return d
}
func j(_ v: Any?) -> Any { v ?? NSNull() }

// ------------------------------------------------------------------------------------------------ JSON shapes
func filtersJSON(_ f: Filters) -> [String: Any] {
    ["sides": f.sides.sorted(), "hood": j(f.hood), "cuisine": j(f.cuisine), "grades": f.grades.map(\.rawValue).sorted(),
     "liquor": f.liquor, "dineIn": f.dineIn, "hideChains": f.hideChains, "includeVenues": f.includeVenues, "city": j(f.city)]
}

let placeFields = ["id", "name", "addr", "zip", "lat", "lon", "city", "hood", "side", "cuisine", "brand", "chain", "venue", "isChicago", "web",
                   "dineIn", "liquor", "patio", "late", "since", "sinceFloor", "sinceVerified", "risk", "visits", "fails", "passCond", "violPer",
                   "seriousPer", "pests", "complaints", "lastDate", "lastResult", "score", "grade", "newerResult", "newerDate", "bldg", "bldgClass",
                   "bldgExact", "stars", "bib", "green", "jbf", "honors", "icon", "iconPts", "sales", "salesYear", "salesLabel", "salesKind", "aka",
                   "searchText", "nameText", "altBytes", "joinBytes", "placeLine", "isHonored", "passedSince", "failedSince", "isChain", "privateDining"]
func placeJSON(_ p: Place) -> [Any] {
    [p.id, p.name, j(p.addr), j(p.zip), j(p.lat), j(p.lon), p.city, j(p.hood), j(p.side), p.cuisine, j(p.brand), p.chain, p.venue, p.isChicago,
     j(p.web?.absoluteString), j(p.dineIn), j(p.liquor), j(p.patio), j(p.late), j(p.since), p.sinceFloor, p.sinceVerified, j(p.risk), j(p.visits),
     j(p.fails), j(p.passCond), j(p.violPer), j(p.seriousPer), j(p.pests), j(p.complaints), j(p.lastDate), j(p.lastResult), j(p.score),
     j(p.grade?.rawValue), j(p.newerResult), j(p.newerDate), j(p.bldg), j(p.bldgClass), j(p.bldgExact), j(p.stars), p.bib, p.green, j(p.jbf),
     j(p.honors), j(p.icon), j(p.iconPts), j(p.sales), j(p.salesYear), j(p.salesLabel), j(p.salesKind), j(p.aka), p.searchText, p.nameText,
     p.altBytes, p.joinBytes, p.placeLine, p.isHonored, p.passedSince, p.failedSince, p.isChain, p.isChicago && Finder.isPrivateDining(p)]
}
func parseJSON(_ q: Query) -> [String: Any] {
    ["tokens": q.tokens.map { ["needles": $0.needles, "typed": $0.typed] as [String: Any] }, "hoods": q.hoods.sorted(), "city": j(q.city),
     "side": j(q.side), "phraseRaw": j(q.phraseRaw), "isPlaceOrFood": q.isPlaceOrFood, "isEmpty": q.isEmpty]
}

// ------------------------------------------------------------------------------------------------ queries
struct Q: Hashable { let dataset: String; let scope: Scope; let text: String; let source: String
    static func == (a: Q, b: Q) -> Bool { a.dataset == b.dataset && a.scope == b.scope && a.text == b.text }
    func hash(into h: inout Hasher) { h.combine(dataset); h.combine(scope); h.combine(text) }
}

/// A Swift string literal's contents, unescaped.
func unescape(_ s: String) -> String {
    var out = "", it = Array(s), i = 0
    while i < it.count {
        let c = it[i]
        if c == "\\", i + 1 < it.count {
            let n = it[i + 1]
            switch n {
            case "n": out.append("\n"); i += 2
            case "t": out.append("\t"); i += 2
            case "u":
                if let close = it[i...].firstIndex(of: "}"), let v = UInt32(String(it[(i + 3)..<close]), radix: 16), let u = Unicode.Scalar(v) {
                    out.unicodeScalars.append(u); i = close + 1
                } else { out.append(n); i += 2 }
            default: out.append(n); i += 2
            }
        } else { out.append(c); i += 1 }
    }
    return out
}

/// Every search DataAndSearchTests runs: the coverage QA sample (Case(text:...)), the name-first cases ("wingz", "id"),
/// the rules fixture's ids("...") / ruled("...") / parse("..."), and the plain searches on the data.
func testQueries(_ path: String) -> [Q] {
    guard let src = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
    let lit = #""((?:[^"\\]|\\.)*)""#
    var out: [Q] = []
    func each(_ pattern: String, _ body: ([String?]) -> Void) {
        let re = try! NSRegularExpression(pattern: pattern)
        for m in re.matches(in: src, range: NSRange(src.startIndex..., in: src)) {
            body((0..<m.numberOfRanges).map { k in Range(m.range(at: k), in: src).map { String(src[$0]) } })
        }
    }
    each(#"Case\(text: "# + lit + #"(?:, scope: \.(chicago|illinois))?"#) { g in
        out.append(Q(dataset: "bundled", scope: Scope(rawValue: g[2] ?? "chicago")!, text: unescape(g[1]!), source: "coverage sample"))
    }
    each(#"\(\s*"# + lit + #"\s*,\s*"\d+"\s*\)"#) { g in
        out.append(Q(dataset: "bundled", scope: .chicago, text: unescape(g[1]!), source: "name-first test"))
    }
    each(#"\b(?:ids|ruled)\("# + lit + #"(?:, \.(chicago|illinois))?\)"#) { g in
        out.append(Q(dataset: "rules", scope: Scope(rawValue: g[2] ?? "chicago")!, text: unescape(g[1]!), source: "rules test"))
    }
    each(#"\.parse\("# + lit + #", scope: \.(chicago|illinois)\)"#) { g in
        out.append(Q(dataset: "rules", scope: Scope(rawValue: g[2]!)!, text: unescape(g[1]!), source: "rules test"))
    }
    each(#"\bsearch\("# + lit + #", \.(chicago|illinois)\)"#) { g in
        out.append(Q(dataset: "bundled", scope: Scope(rawValue: g[2]!)!, text: unescape(g[1]!), source: "data test"))
    }
    each(#"SearchRequest\(text: "# + lit + #", scope: \.(chicago|illinois)"#) { g in
        out.append(Q(dataset: "bundled", scope: Scope(rawValue: g[2]!)!, text: unescape(g[1]!), source: "data test"))
    }
    each(#"queries \+= \[([^\]]*)\]"#) { g in
        let re = try! NSRegularExpression(pattern: lit)
        let body = g[1]!
        for m in re.matches(in: body, range: NSRange(body.startIndex..., in: body)) {
            let t = unescape(String(body[Range(m.range(at: 1), in: body)!]))
            for s in Scope.allCases { out.append(Q(dataset: "bundled", scope: s, text: t, source: "speed test")) }
        }
    }
    return out
}

func tsvQueries(_ path: String) -> [Q] {
    guard let src = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
    return src.split(separator: "\n", omittingEmptySubsequences: true).compactMap { line in
        if line.hasPrefix("#") { return nil }
        let parts = line.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false)
        guard parts.count == 3, let scope = Scope(rawValue: String(parts[1])) else { return nil }
        return Q(dataset: String(parts[0]), scope: scope, text: String(parts[2]), source: "queries.tsv")
    }
}

/// Doubles the letter at `at` ("portillo" -> "porrtillo"): an easy way to get no exact match.
func doubled(_ s: String, at: Int) -> String {
    var cs = Array(s)
    guard cs.count > at, cs[at].isLetter else { return s }
    cs.insert(cs[at], at: at)
    return String(cs)
}
/// Swaps two letters in the middle of the longest word ("malnati" -> "malanti").
func swapped(_ s: String) -> String {
    var words = s.split(separator: " ").map(String.init)
    guard let k = words.indices.max(by: { words[$0].count < words[$1].count }), words[k].count >= 5 else { return s }
    var cs = Array(words[k]); let m = cs.count / 2
    cs.swapAt(m - 1, m)
    words[k] = String(cs)
    return words.joined(separator: " ")
}

/// Searches sampled from the data (deterministic): names, their prefixes and misspellings, aka and alt names, towns,
/// neighborhoods and cuisines.
func sampledQueries(_ r: DataLoader.Result, chicagoTable: DataLoader.Table) -> [Q] {
    var out: [Q] = []
    func add(_ s: Scope, _ t: String, _ why: String) { out.append(Q(dataset: "bundled", scope: s, text: t, source: why)) }
    for (k, p) in r.chicago.enumerated() where k % 30 == 0 {
        add(.chicago, p.name, "sample: name")
        if k % 60 == 0 {
            add(.chicago, String(p.name.prefix((p.name.count + 1) / 2)), "sample: typing")
            add(.chicago, doubled(p.name, at: 2), "sample: doubled letter")
            add(.chicago, swapped(p.name.lowercased()), "sample: swapped letters")
        }
    }
    if let ai = chicagoTable.cols["alt"] {
        var alts: [String] = []
        for row in chicagoTable.rows where ai < row.count {
            if let s = row[ai] as? String { alts += Norm.names(s) } else if let l = row[ai] as? [Any] { alts += l.compactMap { $0 as? String } }
        }
        for (k, a) in alts.enumerated() where k % 12 == 0 { add(.chicago, a, "sample: alt name") }
    }
    let akas = r.chicago.compactMap(\.aka)
    for (k, a) in akas.enumerated() where k % 15 == 0 {
        let names = Norm.names(a)
        add(.chicago, names[k / 15 % names.count], "sample: aka")
    }
    for (k, p) in r.illinois.enumerated() where k % 250 == 0 {
        add(.illinois, p.name, "sample: Illinois name")
        if k % 500 == 0 { add(.illinois, doubled(p.name, at: 3), "sample: Illinois doubled letter") }
    }
    for c in r.cities.prefix(15) { add(.illinois, c, "sample: town") }
    for (k, h) in r.hoods.enumerated() where k % 2 == 0 { add(.chicago, h, "sample: neighborhood") }
    for c in Set(r.cuisines).sorted() { add(.chicago, c, "sample: cuisine") }
    for a in SearchIndex.neighborhoods.keys.sorted() { add(.chicago, a, "sample: neighborhood alias") }
    return out
}

// ------------------------------------------------------------------------------------------------ one dataset
@MainActor
func run(_ name: String, chicago chiData: Data, illinois ilData: Data, queries: [Q], full: Bool) throws -> [String: Any] {
    let loaded = try LoadedData.prepare(chicago: chiData, illinois: ilData, source: .bundle(.main))
    let store = DataStore()
    store.replace(with: loaded)          // also sets Fmt.recordsYear, which Board.metric reads
    let r = loaded.result
    let index = store.index
    var out: [String: Any] = [:]
    out["meta"] = ["recordsThrough": r.recordsThrough, "failsFrom": AsOf(r.recordsThrough).failsFrom, "hoods": r.hoods, "sides": r.sides,
                   "cuisines": r.cuisines, "cities": r.cities, "overtureRelease": r.overtureRelease, "rows": [r.rows.chicago, r.rows.illinois],
                   "restaurantCount": store.restaurantCount, "illinoisRestaurantCount": store.illinoisRestaurantCount,
                   "recordsYear": j(Fmt.recordsYear)] as [String: Any]
    out["placeFields"] = placeFields
    out["chicago"] = r.chicago.map(placeJSON)
    out["illinois"] = r.illinois.map(placeJSON)
    out["surprise"] = loaded.surprisePool.map { r.chicago[$0].id }

    // boards: every board under each filter set, in DataStore.ranked's order, with its count and the default list's metrics
    var filterSets: [Filters] = [Filters()]
    func f(_ edit: (inout Filters) -> Void) -> Filters { var x = Filters(); edit(&x); return x }
    filterSets += [f { $0.includeVenues = true }, f { $0.hideChains = true }, f { $0.liquor = true }, f { $0.dineIn = true },
                   f { $0.grades = [.A, .B] }, f { $0.sides = ["North", "South"] }, f { $0.hideChains = true; $0.grades = [.A] }]
    for s in r.sides { filterSets.append(f { $0.sides = [s] }) }
    for g in Grade.allCases { filterSets.append(f { $0.grades = [g] }) }
    for h in r.hoods { filterSets.append(f { $0.hood = h }) }
    for c in Set(r.cuisines).sorted() { filterSets.append(f { $0.cuisine = c }) }
    if let c = r.cuisines.first { filterSets.append(f { $0.cuisine = c; $0.includeVenues = true; $0.liquor = true }) }
    var boards: [String: Any] = [:]
    for b in Board.allCases {
        var lists: [[String: Any]] = []
        for fs in filterSets {
            let list = store.ranked(b, filters: fs)
            lists.append(["filters": filtersJSON(fs), "ids": list.map(\.id), "count": store.count(b, filters: fs)])
        }
        let top = store.ranked(b, filters: Filters())
        boards[b.rawValue] = ["title": b.title, "short": b.short, "note": j(b.note), "isNegative": b.isNegative,
                              "explainer": b.explainer(recordsThrough: r.recordsThrough), "explainerNoDate": b.explainer(recordsThrough: ""),
                              "lists": lists, "metrics": top.map { let m = b.metric($0); return [$0.id, m.value, m.label] }] as [String: Any]
    }
    out["boards"] = boards
    out["boardOrder"] = Board.allCases.map(\.rawValue)

    // searches: each query plain, and some with filters
    var searches: [[String: Any]] = []
    var chiFilters: [Filters] = [f { $0.grades = [.A] }, f { $0.sides = ["South"] }, f { $0.hideChains = true }, f { $0.includeVenues = true },
                                 f { $0.liquor = true; $0.dineIn = true }]
    if let c = r.cuisines.first(where: { $0 == "Mexican" }) ?? r.cuisines.first { chiFilters.append(f { $0.cuisine = c }) }
    if let h = r.hoods.first(where: { $0 == "West Town" }) ?? r.hoods.first { chiFilters.append(f { $0.hood = h }) }
    var ilFilters: [Filters] = [f { $0.includeVenues = true }, f { $0.hideChains = true }]
    if let c = r.cities.first { ilFilters.append(f { $0.city = c }) }
    if let c = r.cuisines.first(where: { $0 == "Pizza" }) { ilFilters.append(f { $0.cuisine = c }) }
    func search(_ q: Q, _ fs: Filters) {
        let list = q.scope == .chicago ? r.chicago : r.illinois
        let res = Finder.results(SearchRequest(text: q.text, scope: q.scope, filters: fs), chicago: r.chicago, illinois: r.illinois, index: index)
        let all = Finder.matches(q.text, scope: q.scope, filters: fs, in: list, index: index)
        let parsed = index.parse(q.text.trimmingCharacters(in: .whitespacesAndNewlines), scope: q.scope)
        searches.append(["text": q.text, "scope": q.scope.rawValue, "source": q.source, "filters": filtersJSON(fs), "matches": all.map(\.id),
                         "shown": res.places.map(\.id), "total": res.total, "closest": res.closest.map(\.id), "parse": parseJSON(parsed)])
    }
    var seen = Set<Q>()
    let mine = queries.filter { $0.dataset == name && seen.insert($0).inserted }
    for (k, q) in mine.enumerated() {
        search(q, Filters())
        if full ? k % 9 == 0 : true { for fs in (q.scope == .chicago ? chiFilters : ilFilters) { search(q, fs) } }
    }
    for fs in chiFilters { search(Q(dataset: name, scope: .chicago, text: "", source: "filters only"), fs) }
    for fs in ilFilters { search(Q(dataset: name, scope: .illinois, text: "", source: "filters only"), fs) }
    search(Q(dataset: name, scope: .chicago, text: "", source: "empty"), Filters())
    out["searches"] = searches

    // near me: closest first within 50 miles, the out-of-area distance, and the distance labels the rows show
    let points: [(String, Double, Double)] = [("Loop", 41.88194, -87.62778), ("Pilsen", 41.8565, -87.6597), ("Naperville", 41.7508, -88.1535),
                                              ("Springfield", 39.7817, -89.6501), ("O'Hare", 41.9786, -87.9048), ("Lake Michigan", 41.90, -87.40),
                                              ("Denver", 39.7392, -104.9903), ("Carbondale", 37.7273, -89.2168)]
    let nearTexts = ["", "pizza", "tacos pilsen", "starbucks", "naperville", "lou malnati's", "zzqx", "portilllo"]
    var nearFilters: [Filters] = [Filters(), f { $0.grades = [.A] }, f { $0.includeVenues = true }, f { $0.hideChains = true }]
    if let c = r.cities.first { nearFilters.append(f { $0.city = c }) }
    var near: [[String: Any]] = []
    for (label, lat, lon) in points {
        for (ti, t) in nearTexts.enumerated() {
            for (fi, fs) in nearFilters.enumerated() where fi == 0 || ti < 2 {
                let req = SearchRequest(text: t, scope: .chicago, filters: fs, near: true, point: (lat, lon))
                let res = Finder.results(req, chicago: r.chicago, illinois: r.illinois, index: index)
                let pt = req.point!
                near.append(["where": label, "point": [lat, lon], "rounded": [pt.0, pt.1], "text": t, "filters": filtersJSON(fs),
                             "ids": res.places.map(\.id), "total": res.total, "outOfArea": j(res.outOfArea),
                             "labels": res.places.prefix(40).map { Geo.label(Geo.distance($0, pt)) }])
            }
        }
        let best = Finder.nearest(to: (lat, lon), chicago: r.chicago, illinois: r.illinois)
        let counts = store.areaCounts(near: (lat, lon)), within = store.areaCounts(near: (lat, lon), meters: 800)   // MapTab.goTo: 800 m
        near.append(["where": label, "point": [lat, lon], "nearest": j(best?.place.id), "nearestMeters": j(best?.meters),
                     "areaCounts": [counts.chicago, counts.illinois], "areaCounts800": [within.chicago, within.illinois]])
    }
    out["near"] = near

    // formatters, on every value the data has and a few on purpose at the edges
    var dates = Set(r.chicago.flatMap { [$0.lastDate, $0.newerDate].compactMap { $0 } })
    dates.formUnion([r.recordsThrough, "2026-02-30", "2026-9-1", "", "abcd", "2024-02-29", "2026-12-31", "2027-01-01"])
    var money = Set(r.chicago.flatMap { [$0.bldg, $0.sales].compactMap { $0 } })
    money.formUnion([0, 7, 999, 1000, 1499, 1500, 999_499, 999_500, 999_999, 1_000_000, 1_050_000, 1_250_000, 99_949_999, 99_950_000,
                     100_000_000, 100_500_000, 999_999_999, 1_000_000_000, 1_005_000_000, 2_345_678_901, -1_500, -2_500_000])
    let items = Set(r.chicago.flatMap { [$0.jbf, $0.honors, $0.icon].compactMap { $0 } }).union(["a; b (c; d); e", "x;y; z", "  (a; b ; c)  ; d", ";", ""])
    var meters: [Double] = [0, 50, 160.9, 160.9344, 161, 1000, 1609.344, 15_000, 16_093.44, 16_093.5, 16_100, 24_140.16, 80_467, 1e6, 2_954_000]
    meters += r.chicago.prefix(200).map { Geo.distance($0, (41.88194, -87.62778)) }.filter(\.isFinite)
    var failsFrom: [String: String] = [:]
    for d in ["2026-09-21", "2026-03-01", "2024-03-01", "2024-05-29", "2026-01-15", "2025-12-31", "", "garbage", "2026-02-30"] { failsFrom[d] = AsOf(d).failsFrom }
    out["fmt"] = ["date": Dictionary(uniqueKeysWithValues: dates.map { ($0, Fmt.date($0)) }),
                  "money": Dictionary(uniqueKeysWithValues: money.map { (String($0), Fmt.money($0)) }),
                  "number": Dictionary(uniqueKeysWithValues: [0, 7, 999, 1000, 12_345, 1_234_567, -5, 17826].map { (String($0), Fmt.number($0)) }),
                  "items": Dictionary(uniqueKeysWithValues: items.map { ($0, Fmt.items($0)) }),
                  "geoLabel": meters.map { [$0, Geo.label($0)] as [Any] },
                  "failsFrom": failsFrom] as [String: Any]
    return out
}

// ------------------------------------------------------------------------------------------------ main
@MainActor
func main() throws {
    func sha(_ d: Data) -> String { DataFiles.sha256(d) }
    let chi = readData(resDir + "/chicago.json"), il = readData(resDir + "/illinois.json")
    let bundledTable = try DataLoader.table("chicago", data: chi)
    let bundledResult = try DataLoader.loadAll(chicagoData: chi, illinoisData: il)
    var queries = tsvQueries(toolsDir + "/queries.tsv") + testQueries(testsPath) + sampledQueries(bundledResult, chicagoTable: bundledTable)
    if queries.isEmpty { queries = [] }
    var datasets: [String: Any] = [:]
    let t0 = Date()
    datasets["bundled"] = try run("bundled", chicago: chi, illinois: il, queries: queries, full: true)
    for name in ["rules", "edge"] {
        let fx = try JSONSerialization.jsonObject(with: readData(toolsDir + "/fixtures/\(name).json")) as! [String: Any]
        datasets[name] = try run(name, chicago: JSONSerialization.data(withJSONObject: fx["chicago"]!),
                                 illinois: JSONSerialization.data(withJSONObject: fx["illinois"]!), queries: queries, full: false)
    }
    let out: [String: Any] = ["inputs": ["chicago": ["sha256": sha(chi), "bytes": chi.count], "illinois": ["sha256": sha(il), "bytes": il.count]],
                              "seconds": Date().timeIntervalSince(t0), "datasets": datasets]
    let data = try JSONSerialization.data(withJSONObject: out, options: [])
    try data.write(to: URL(fileURLWithPath: outPath))
    let n = (datasets.values.compactMap { ($0 as? [String: Any])?["searches"] as? [Any] }).map(\.count).reduce(0, +)
    print("oracle: \(n) searches, \(data.count) bytes -> \(outPath)")
}
try MainActor.assumeIsolated { try main() }
