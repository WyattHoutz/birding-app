/* =========================================================================
   SPUH MODEL — uncertain IDs as published candidate sets, not a fake tree
   =========================================================================

   eBird's taxonomy is flat. A spuh row names a genus or broader uncertain ID,
   but several rows overlap and some carry exactly the same published species
   set. The model is therefore:

     spuh label -> coverage class (exact species-code set)
                -> minimal broader/narrower coverage classes (a DAG)

   It is deliberately NOT one-parent ownership. Bicolored Mouse-Warbler, for
   example, belongs to overlapping mouse-warbler and scrubwren groups. A model
   that forces one owner produces a neat tree and a wrong answer.

   Browser:
     var packed = Spuh.packTaxonomy(rows);
     var model = Spuh.create(packed);

   Node:
     var Spuh = require('../www/spuh.js');
   ========================================================================= */
(function (global) {
  'use strict';

  var SCHEMA = 1;
  var GLOSS = /\s*\([^()]*\)\s*$/;
  var SPECIES_LIST = /^([A-Z][A-Za-z-]+)\s+([a-z][A-Za-z-]*(?:\/[A-Z][A-Za-z-]+\s+[a-z][A-Za-z-]*|\/[a-z][A-Za-z-]*)+)$/;

  function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function uniqSorted(nums) {
    var seen = Object.create(null), out = [];
    (nums || []).forEach(function (n) {
      n = Number(n);
      if (!isFinite(n) || seen[n]) return;
      seen[n] = 1;
      out.push(n);
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  function stripSpuhName(sci) {
    return String(sci || '').replace(GLOSS, '').replace(/\s+sp\.$/, '').trim();
  }

  function parseSpeciesList(sci, speciesBySci) {
    var bare = String(sci || '').replace(GLOSS, '').trim();
    if (/\s+sp\.$/.test(bare) || bare.indexOf('/') < 0) return null;
    var m = bare.match(SPECIES_LIST);
    if (!m) return null;
    var parts = bare.split('/'), genus = '', names = [], failed = false;
    parts.forEach(function (part, i) {
      part = part.trim();
      var words = part.split(/\s+/);
      if (i === 0 || words.length > 1) {
        if (words.length < 2 || !/^[A-Z]/.test(words[0])) { failed = true; return; }
        genus = words[0];
        names.push(words[0] + ' ' + words.slice(1).join(' '));
      } else if (genus) {
        names.push(genus + ' ' + part);
      } else {
        failed = true;
      }
    });
    if (failed || !names.length) return null;
    var rows = [];
    names.forEach(function (name) {
      var row = speciesBySci[norm(name)];
      if (!row) failed = true;
      else rows.push(row);
    });
    return failed ? null : rows;
  }

  function packTaxonomy(rows) {
    if (Object.prototype.toString.call(rows) !== '[object Array]') {
      throw new Error('Spuh.packTaxonomy requires an eBird taxonomy array');
    }
    var species = [], spuhs = [], aliases = [];
    rows.forEach(function (row) {
      if (!row || !row.speciesCode) return;
      var tuple = [
        String(row.speciesCode),
        String(row.comName || ''),
        String(row.sciName || ''),
        String(row.order || ''),
        String(row.familySciName || ''),
        String(row.familyComName || ''),
        Number(row.taxonOrder || 0)
      ];
      if (row.category === 'species') species.push(tuple);
      else if (row.category === 'spuh') spuhs.push(tuple);
      if (row.reportAs) aliases.push([String(row.speciesCode), String(row.reportAs)]);
    });
    species.sort(function (a, b) { return a[6] - b[6]; });
    spuhs.sort(function (a, b) { return a[6] - b[6]; });
    aliases.sort(function (a, b) { return a[0].localeCompare(b[0]); });
    return { v: SCHEMA, species: species, spuhs: spuhs, aliases: aliases };
  }

  function rowFromTuple(t) {
    return {
      code: t[0], name: t[1], sci: t[2], order: t[3],
      familySci: t[4], familyCom: t[5], taxonOrder: Number(t[6] || 0)
    };
  }

  function isSubset(a, b) {
    if (!a || !b || a.length > b.length) return false;
    var i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; }
      else if (a[i] > b[j]) j++;
      else return false;
    }
    return i === a.length;
  }

  function exactEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function create(packed) {
    if (!packed || packed.v !== SCHEMA) {
      throw new Error('Unsupported spuh model schema');
    }
    var species = (packed.species || []).map(rowFromTuple);
    var spuhRows = (packed.spuhs || []).map(rowFromTuple);
    var aliases = Object.create(null);
    (packed.aliases || []).forEach(function (pair) { aliases[pair[0]] = pair[1]; });

    var speciesByCode = Object.create(null);
    var speciesBySci = Object.create(null);
    var byGenus = Object.create(null);
    var byFamily = Object.create(null);
    var byOrder = Object.create(null);
    species.forEach(function (row, index) {
      row.id = index;
      row.genus = row.sci.split(/\s+/)[0] || '';
      speciesByCode[row.code] = row;
      speciesBySci[norm(row.sci)] = row;
      (byGenus[row.genus] || (byGenus[row.genus] = [])).push(row);
      if (row.familySci) {
        (byFamily[row.familySci] || (byFamily[row.familySci] = [])).push(row);
      }
      if (row.order) {
        (byOrder[row.order] || (byOrder[row.order] = [])).push(row);
      }
    });

    function union(groups) {
      var ids = [];
      groups.forEach(function (group) {
        (group || []).forEach(function (row) { ids.push(row.id); });
      });
      return uniqSorted(ids);
    }

    function resolveCoverage(row) {
      var raw = row.sci;
      var glossMatch = raw.match(/\(([^()]*)\)\s*$/);
      var gloss = glossMatch ? glossMatch[1] : '';
      var head = stripSpuhName(raw);
      var parts, groups, exact;
      var result = {
        species: [],
        rank: 'class',
        group: 'Aves',
        route: 'fallback-aves',
        gloss: gloss,
        limited: ''
      };

      if (/^Aves$/i.test(head)) {
        result.species = species.map(function (s) { return s.id; });
        result.route = 'class';
        return result;
      }

      exact = parseSpeciesList(raw, speciesBySci);
      if (exact) {
        result.species = uniqSorted(exact.map(function (s) { return s.id; }));
        result.rank = 'species list';
        result.group = head;
        result.route = 'species-list';
        return result;
      }

      if (head && /^[A-Z][A-Za-z-]+(?:\/[A-Z][A-Za-z-]+)*$/.test(head)) {
        parts = head.split('/');
        groups = parts.map(function (p) { return byGenus[p]; });
        if (groups.every(Boolean)) {
          result.species = union(groups);
          result.rank = parts.length > 1 ? 'genera' : 'genus';
          result.group = head;
          result.route = parts.length > 1 ? 'genus-list' : 'genus';
          return result;
        }
        groups = parts.map(function (p) { return byFamily[p]; });
        if (groups.every(Boolean)) {
          result.species = union(groups);
          result.rank = parts.length > 1 ? 'families' : 'family';
          result.group = head;
          result.route = parts.length > 1 ? 'family-list' : 'family';
          return result;
        }
        groups = parts.map(function (p) { return byOrder[p]; });
        if (groups.every(Boolean)) {
          result.species = union(groups);
          result.rank = parts.length > 1 ? 'orders' : 'order';
          result.group = head;
          result.route = parts.length > 1 ? 'order-list' : 'order';
          return result;
        }
      }

      if (byFamily[head]) {
        result.species = union([byFamily[head]]);
        result.rank = 'family';
        result.group = head;
        result.route = 'family';
        return result;
      }
      if (byOrder[head]) {
        result.species = union([byOrder[head]]);
        result.rank = 'order';
        result.group = head;
        result.route = 'order';
        return result;
      }

      if (row.familySci && byFamily[row.familySci]) {
        result.species = union([byFamily[row.familySci]]);
        result.rank = 'family';
        result.group = row.familySci;
        result.route = 'row-family';
        result.limited = /inae$/i.test(head) ? 'subfamily' : 'unpublished-group';
        return result;
      }
      if (row.order && byOrder[row.order]) {
        result.species = union([byOrder[row.order]]);
        result.rank = 'order';
        result.group = row.order;
        result.route = 'row-order';
        result.limited = 'unpublished-group';
        return result;
      }

      result.species = species.map(function (s) { return s.id; });
      result.limited = 'unpublished-group';
      return result;
    }

    var nodes = [];
    var nodeByCode = Object.create(null);
    var classByKey = Object.create(null);
    var classes = [];
    spuhRows.forEach(function (row, index) {
      var coverage = resolveCoverage(row);
      var key = coverage.species.join(',');
      var coverageClass = classByKey[key];
      if (!coverageClass) {
        coverageClass = {
          id: classes.length,
          species: coverage.species,
          speciesSet: new Set(coverage.species),
          nodes: [],
          parents: null,
          children: null
        };
        classes.push(coverageClass);
        classByKey[key] = coverageClass;
      }
      var node = {
        id: index,
        code: row.code,
        name: row.name,
        sci: row.sci,
        taxonOrder: row.taxonOrder,
        coverageId: coverageClass.id,
        rank: coverage.rank,
        group: coverage.group,
        route: coverage.route,
        gloss: coverage.gloss,
        limit: coverage.limited,
        definition: ''
      };
      nodes.push(node);
      coverageClass.nodes.push(node);
      nodeByCode[node.code] = node;
    });

    // A parenthetical gloss narrows the published group named before it even
    // when no second spuh happens to share that coverage. Explicit species
    // lists publish their members directly and are not coverage-limited.
    classes.forEach(function (coverageClass) {
      coverageClass.nodes.forEach(function (node) {
        var namesPublishedCoverage = stripSpuhName(node.sci) === node.group;
        if (node.gloss && !node.limit && node.route !== 'species-list'
            && (coverageClass.nodes.length > 1 || namesPublishedCoverage)) {
          node.limit = 'same-group';
        }
      });
    });

    function nodeScore(node) {
      var head = stripSpuhName(node.sci);
      return [
        node.limit ? 1 : 0,
        head === node.group ? 0 : 1,
        node.gloss ? 1 : 0,
        node.name.length,
        node.taxonOrder
      ];
    }

    function compareScores(a, b) {
      var x = nodeScore(a), y = nodeScore(b);
      for (var i = 0; i < x.length; i++) {
        if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
      }
      return 0;
    }

    classes.forEach(function (coverageClass) {
      coverageClass.nodes.sort(compareScores);
      coverageClass.provenNodes = coverageClass.nodes.filter(function (n) {
        return !n.limit;
      });
      coverageClass.head = coverageClass.provenNodes[0]
        || coverageClass.nodes[0]
        || null;
    });

    function minimalBroader(classId) {
      var child = classes[classId];
      var candidates = classes.filter(function (parent) {
        return parent.id !== child.id
          && parent.species.length > child.species.length
          && isSubset(child.species, parent.species);
      }).sort(function (a, b) {
        return a.species.length - b.species.length;
      });
      var out = [];
      candidates.forEach(function (candidate) {
        var dominated = out.some(function (kept) {
          return isSubset(kept.species, candidate.species);
        });
        if (!dominated) out.push(candidate);
      });
      return out;
    }

    function minimalNarrower(classId) {
      var parent = classes[classId];
      var candidates = classes.filter(function (child) {
        return child.id !== parent.id
          && child.species.length < parent.species.length
          && isSubset(child.species, parent.species);
      }).sort(function (a, b) {
        return b.species.length - a.species.length;
      });
      var out = [];
      candidates.forEach(function (candidate) {
        var dominated = out.some(function (kept) {
          return isSubset(candidate.species, kept.species);
        });
        if (!dominated) out.push(candidate);
      });
      return out;
    }

    function classParents(classId) {
      var c = classes[classId];
      if (!c.parents) c.parents = minimalBroader(classId).map(function (p) {
        return p.id;
      });
      return c.parents.map(function (id) { return classes[id]; });
    }

    function classChildren(classId) {
      var c = classes[classId];
      if (!c.children) c.children = minimalNarrower(classId).map(function (p) {
        return p.id;
      });
      return c.children.map(function (id) { return classes[id]; });
    }

    function resolveSpecies(code) {
      var seen = Object.create(null), cur = String(code || '');
      while (cur && !speciesByCode[cur] && aliases[cur] && !seen[cur]) {
        seen[cur] = 1;
        cur = aliases[cur];
      }
      return speciesByCode[cur] || null;
    }

    function classesContainingSpecies(code) {
      var row = resolveSpecies(code);
      if (!row) return [];
      return classes.filter(function (coverageClass) {
        return coverageClass.speciesSet.has(row.id);
      }).sort(function (a, b) {
        if (b.species.length !== a.species.length) {
          return b.species.length - a.species.length;
        }
        return (a.head ? a.head.taxonOrder : 0)
          - (b.head ? b.head.taxonOrder : 0);
      });
    }

    function minimalSharedClasses(codes, provenOnly) {
      var rows = (codes || []).map(resolveSpecies).filter(Boolean);
      if (!rows.length || rows.length !== (codes || []).length) return [];
      var candidates = classes.filter(function (coverageClass) {
        if (provenOnly && !coverageClass.provenNodes.length) return false;
        return rows.every(function (row) {
          return coverageClass.speciesSet.has(row.id);
        });
      }).sort(function (a, b) {
        return a.species.length - b.species.length;
      });
      var out = [];
      candidates.forEach(function (candidate) {
        var dominated = out.some(function (kept) {
          return isSubset(kept.species, candidate.species);
        });
        if (!dominated) out.push(candidate);
      });
      return out;
    }

    function searchRows(list, query, limit) {
      var q = norm(query);
      if (!q) return [];
      var words = q.split(' ');
      return list.map(function (row) {
        var hay = norm(row.name + ' ' + row.sci + ' ' + row.code);
        var exact = norm(row.name) === q || norm(row.code) === q ? 0 : 1;
        var prefix = norm(row.name).indexOf(q) === 0 ? 0 : 1;
        var match = words.every(function (word) {
          return hay.indexOf(word) >= 0;
        });
        return match ? { row: row, score: [exact, prefix, row.name.length] } : null;
      }).filter(Boolean).sort(function (a, b) {
        return a.score[0] - b.score[0]
          || a.score[1] - b.score[1]
          || a.score[2] - b.score[2]
          || a.row.name.localeCompare(b.row.name);
      }).slice(0, limit || 30).map(function (x) { return x.row; });
    }

    function coverageLabel(coverageClass) {
      if (!coverageClass) return null;
      return coverageClass.provenNodes[0] || coverageClass.head;
    }

    function definition(node) {
      var c = classes[node.coverageId];
      var plain = node.name.replace(/\s+sp\.$/i, '');
      var text = 'An unresolved ' + plain + ' identification. Use this when '
        + 'you can place the bird in ' + node.rank + ' ' + node.group
        + ' but do not have enough field marks, views, sound, or media to '
        + 'support a narrower identification. The published scope contains '
        + c.species.length + ' possible species.';
      if (node.limit) {
        text += ' eBird does not publish distinct membership for this narrower '
          + 'wording, so automatic recommendations stop at a proven group.';
      }
      return text;
    }

    nodes.forEach(function (node) { node.definition = definition(node); });

    return {
      schema: SCHEMA,
      nodes: nodes,
      species: species,
      classes: classes,
      aliases: aliases,
      node: function (code) { return nodeByCode[String(code || '')] || null; },
      speciesRow: resolveSpecies,
      searchSpuh: function (query, limit) {
        return searchRows(nodes, query, limit);
      },
      searchSpecies: function (query, limit) {
        return searchRows(species, query, limit);
      },
      coverage: function (nodeOrCode) {
        var n = typeof nodeOrCode === 'string'
          ? nodeByCode[nodeOrCode]
          : nodeOrCode;
        return n ? classes[n.coverageId] : null;
      },
      candidates: function (nodeOrCode) {
        var c = this.coverage(nodeOrCode);
        return c ? c.species.map(function (id) { return species[id]; }) : [];
      },
      broader: function (nodeOrCode) {
        var c = this.coverage(nodeOrCode);
        return c ? classParents(c.id) : [];
      },
      narrower: function (nodeOrCode) {
        var c = this.coverage(nodeOrCode);
        return c ? classChildren(c.id) : [];
      },
      relatedForSpecies: classesContainingSpecies,
      narrowestShared: function (codes) {
        return minimalSharedClasses(codes, true).map(function (c) {
          return { coverage: c, node: coverageLabel(c) };
        }).filter(function (x) { return x.node; });
      },
      definition: function (nodeOrCode) {
        var n = typeof nodeOrCode === 'string'
          ? nodeByCode[nodeOrCode]
          : nodeOrCode;
        return n ? n.definition : '';
      },
      pack: packed
    };
  }

  var API = {
    SCHEMA: SCHEMA,
    packTaxonomy: packTaxonomy,
    create: create,
    createFromTaxonomy: function (rows) {
      return create(packTaxonomy(rows));
    },
    _parseSpeciesList: parseSpeciesList,
    _isSubset: isSubset,
    _exactEqual: exactEqual
  };

  global.Spuh = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}(typeof window !== 'undefined' ? window : this));
