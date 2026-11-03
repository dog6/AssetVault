import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AudioLines, Box, Braces, ChevronDown, ChevronRight, CircleHelp, Clock3, Code2,
  Folder, FolderOpen, Grid2X2, Heart, Image, Layers3, ListFilter, MoreHorizontal,
  PackageOpen, Plus, Search, Settings2, Star, Tag, X,
} from "lucide-react";
import hljs from "highlight.js/lib/core";
import csharp from "highlight.js/lib/languages/csharp";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import "highlight.js/styles/github-dark.css";
import "./styles.css";

hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

type Project = { id: string; name: string; path: string; source: string };
type Asset = {
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: number;
  projectId: string;
  projectName: string;
  tags: string[];
  favorite: boolean;
  collection: string;
};
type Library = { projects: Project[]; assets: Asset[]; blenderPath: string };
type Metadata = Partial<Pick<Asset, "tags" | "favorite" | "collection">>;

declare global {
  interface Window {
    assetVault: {
      getLibrary: () => Promise<Library>;
      addProject: () => Promise<Project | null>;
      scanParentFolder: () => Promise<Project[]>;
      cloneGithub: (url: string) => Promise<Project | null>;
      removeProject: (id: string) => Promise<Library>;
      updateMetadata: (path: string, metadata: Metadata) => Promise<Metadata>;
      readText: (path: string) => Promise<string>;
      getAssetUrl: (path: string) => Promise<string>;
      getModelPreviewUrl: (path: string) => Promise<string>;
      chooseBlender: () => Promise<string>;
    };
  }
}

type Category = "All assets" | "Models" | "Images" | "Audio" | "Scripts" | "Favorites";
const MODEL_EXTENSIONS = new Set(["blend", "fbx", "obj", "gltf", "glb"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"]);
const AUDIO_EXTENSIONS = new Set(["wav", "mp3", "ogg", "m4a", "flac", "aiff"]);
const CODE_EXTENSIONS = new Set(["cs", "js", "ts", "json", "shader", "compute", "hlsl", "cginc", "glsl", "xml", "yaml", "yml", "txt", "md"]);
const CATEGORIES: Category[] = ["All assets", "Models", "Images", "Audio", "Scripts", "Favorites"];

function categoryOf(asset: Asset): Exclude<Category, "All assets" | "Favorites"> | "Other" {
  if (MODEL_EXTENSIONS.has(asset.extension)) return "Models";
  if (IMAGE_EXTENSIONS.has(asset.extension)) return "Images";
  if (AUDIO_EXTENSIONS.has(asset.extension)) return "Audio";
  if (CODE_EXTENSIONS.has(asset.extension)) return "Scripts";
  return "Other";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}

function iconFor(asset: Asset) {
  if (MODEL_EXTENSIONS.has(asset.extension)) return <Box size={17} />;
  if (IMAGE_EXTENSIONS.has(asset.extension)) return <Image size={17} />;
  if (AUDIO_EXTENSIONS.has(asset.extension)) return <AudioLines size={17} />;
  if (CODE_EXTENSIONS.has(asset.extension)) return <Code2 size={17} />;
  return <PackageOpen size={17} />;
}

function App() {
  const [library, setLibrary] = useState<Library>({ projects: [], assets: [], blenderPath: "" });
  const [activeCategory, setActiveCategory] = useState<Category>("All assets");
  const [activeProject, setActiveProject] = useState<string>("all");
  const [activeCollection, setActiveCollection] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [showGithub, setShowGithub] = useState(false);
  const [groupByProject, setGroupByProject] = useState(false);
  const [showCollections, setShowCollections] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortMode, setSortMode] = useState<"name" | "modified">("name");
  const [tagEditor, setTagEditor] = useState(false);
  const [collectionEditor, setCollectionEditor] = useState(false);

  const refresh = async (keepSelection = true) => {
    setError("");
    try {
      const next = await window.assetVault.getLibrary();
      setLibrary(next);
      if (keepSelection && selected) {
        setSelected(next.assets.find((asset) => asset.path === selected.path) || null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(false); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const collections = useMemo(() => [...new Set(library.assets.map((asset) => asset.collection).filter(Boolean))].sort(), [library.assets]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library.assets.filter((asset) => {
      if (activeCategory === "Favorites" && !asset.favorite) return false;
      if (activeCategory !== "All assets" && activeCategory !== "Favorites" && categoryOf(asset) !== activeCategory) return false;
      if (activeProject !== "all" && asset.projectId !== activeProject) return false;
      if (activeCollection === "uncategorized" && asset.collection) return false;
      if (activeCollection !== "all" && activeCollection !== "uncategorized" && asset.collection !== activeCollection) return false;
      return !needle || [asset.name, asset.projectName, asset.extension, ...asset.tags].some((value) => value.toLowerCase().includes(needle));
    }).sort((a, b) => sortMode === "modified" ? b.modifiedAt - a.modifiedAt : a.name.localeCompare(b.name));
  }, [library.assets, activeCategory, activeProject, activeCollection, query, sortMode]);

  const updateMetadata = async (asset: Asset, metadata: Metadata) => {
    try {
      await window.assetVault.updateMetadata(asset.path, metadata);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const runAction = async (action: () => Promise<unknown>, message: string, progressMessage = message) => {
    setBusy(progressMessage);
    setError("");
    try {
      const result = await action();
      if (result === null || (Array.isArray(result) && result.length === 0)) return;
      await refresh(false);
      setToast(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  };

  const addFolder = () => runAction(() => window.assetVault.addProject(), "Project folder added");
  const scanParent = () => runAction(() => window.assetVault.scanParentFolder(), "Unity projects scanned");
  const cloneRepository = async (event: React.FormEvent) => {
    event.preventDefault();
    const url = githubUrl.trim();
    if (!url) return;
    await runAction(() => window.assetVault.cloneGithub(url), "Repository cloned", "Cloning repository");
    setGithubUrl("");
    setShowGithub(false);
  };
  const chooseBlender = async () => {
    try {
      const blenderPath = await window.assetVault.chooseBlender();
      setLibrary((current) => ({ ...current, blenderPath }));
      if (blenderPath) setToast("Blender configured");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const groupedAssets = useMemo(() => {
    if (!groupByProject) return [];
    const groups = new Map<string, Asset[]>();
    for (const asset of filtered) groups.set(asset.projectName, [...(groups.get(asset.projectName) || []), asset]);
    return [...groups.entries()];
  }, [filtered, groupByProject]);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand-mark"><Layers3 size={15} strokeWidth={2.5} /></div>
        <span className="brand-name">asset<span>vault</span></span>
        <div className="titlebar-divider" />
        <span className="titlebar-caption">Unity library</span>
        <div className="titlebar-spacer" />
        <span className="titlebar-status"><span className="status-dot" /> Local library</span>
        <button className="icon-button titlebar-help" title="About Asset Vault"><CircleHelp size={15} /></button>
      </header>

      <div className="workspace">
        <aside className="activity-rail">
          <div className="rail-active"><Layers3 size={20} /></div>
          <div className="rail-spacer" />
          <button className="rail-button" title="Settings" onClick={() => document.getElementById("settings")?.scrollIntoView({ behavior: "smooth" })}><Settings2 size={19} /></button>
        </aside>

        <aside className="sidebar">
          <div className="sidebar-heading"><span>EXPLORER</span><button className="icon-button small" title="Refresh library" onClick={() => void refresh()}><MoreHorizontal size={17} /></button></div>
          <button className={`tree-root ${activeProject === "all" ? "selected" : ""}`} onClick={() => { setActiveProject("all"); setActiveCollection("all"); }}>
            <ChevronDown size={14} /><FolderOpen size={16} /><span>ASSET LIBRARY</span><span className="tree-count">{library.assets.length}</span>
          </button>
          <div className="tree-children">
            {library.projects.map((project) => (
              <div key={project.id} role="button" tabIndex={0} className={`project-tree-item ${activeProject === project.id ? "selected" : ""}`} title={project.path} onClick={() => { setActiveProject(project.id); setActiveCollection("all"); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setActiveProject(project.id); setActiveCollection("all"); } }}>
                <ChevronRight size={13} /><Folder size={15} /><span>{project.name}</span>
                <button className="remove-project" title={`Remove ${project.name} from library`} onClick={(event) => {
                  event.stopPropagation();
                  void runAction(() => window.assetVault.removeProject(project.id), "Project removed");
                  if (selected?.projectId === project.id) setSelected(null);
                  if (activeProject === project.id) setActiveProject("all");
                }}><X size={12} /></button>
              </div>
            ))}
            {library.projects.length === 0 && <p className="sidebar-empty">Add a project folder to get started.</p>}
          </div>
          <div className="sidebar-section-heading">
            <button onClick={() => setShowCollections((value) => !value)}>{showCollections ? <ChevronDown size={13} /> : <ChevronRight size={13} />} COLLECTIONS</button>
            <button className="icon-button small" title="Create a collection from the selected asset" onClick={() => selected && setCollectionEditor(true)}><Plus size={14} /></button>
          </div>
          {showCollections && <div className="collection-list">
            <button className={activeCollection === "all" ? "active" : ""} onClick={() => setActiveCollection("all")}><Grid2X2 size={15} /><span>All assets</span></button>
            <button className={activeCollection === "uncategorized" ? "active" : ""} onClick={() => setActiveCollection("uncategorized")}><Tag size={15} /><span>Uncategorized</span></button>
            {collections.map((collection) => <button key={collection} className={activeCollection === collection ? "active" : ""} onClick={() => setActiveCollection(collection)}><Folder size={15} /><span>{collection}</span></button>)}
          </div>}
          <div className="sidebar-footer">
            <div className="sidebar-section-heading"><span>BLENDER PREVIEWS</span></div>
            <div className="blender-setting" id="settings">
              <span className={`blender-dot ${library.blenderPath ? "ready" : ""}`} />
              <span title={library.blenderPath || "Blender not configured"}>{library.blenderPath ? "Blender ready" : "Blender not set"}</span>
              <button className="icon-button small" onClick={() => void chooseBlender()} title="Choose Blender executable"><Settings2 size={14} /></button>
            </div>
            <p className="blender-hint">Required to preview .blend models.</p>
          </div>
        </aside>

        <main className="main-panel">
          <div className="breadcrumb"><span>Asset Vault</span><ChevronRight size={13} /><span>{activeProject === "all" ? "All projects" : library.projects.find((item) => item.id === activeProject)?.name}</span><span className="breadcrumb-trailing">{activeCategory}</span></div>
          <div className="main-content">
            <div className="page-heading">
              <div><p className="eyebrow">YOUR CREATIVE LIBRARY</p><h1>{activeProject === "all" ? "Assets" : library.projects.find((item) => item.id === activeProject)?.name}</h1><p className="page-subtitle">Browse and organize assets from your Unity projects.</p></div>
              <div className="header-actions">
                <button className="secondary-button" onClick={scanParent} disabled={!!busy}><Search size={15} /> Scan folders</button>
                <button className="secondary-button" onClick={() => setShowGithub((value) => !value)} disabled={!!busy}><GitHubMark /> Clone GitHub</button>
                <button className="primary-button" onClick={addFolder} disabled={!!busy}><Plus size={16} /> Add project</button>
              </div>
            </div>

            {showGithub && <form className="github-form" onSubmit={(event) => void cloneRepository(event)}>
              <div className="github-form-icon"><GitHubMark /></div>
              <div className="github-input-wrap"><label htmlFor="github-url">PUBLIC REPOSITORY URL</label><input id="github-url" autoFocus placeholder="https://github.com/owner/repository" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} /></div>
              <button className="primary-button" type="submit" disabled={!!busy || !githubUrl.trim()}>{busy === "Cloning repository" ? "Cloning..." : "Choose destination & clone"}</button>
              <button type="button" className="icon-button" onClick={() => setShowGithub(false)} title="Close"><X size={16} /></button>
            </form>}

            {error && <div className="error-banner" role="alert"><CircleHelp size={16} /><span>{error}</span><button className="icon-button" onClick={() => setError("")}><X size={15} /></button></div>}
            {busy && <div className="working-banner"><span className="spinner" />{busy}...</div>}

            <div className="stats-row">
              <div className="stat-card"><span className="stat-icon"><PackageOpen size={16} /></span><span className="stat-number">{library.assets.length}</span><span className="stat-label">Total assets</span></div>
              <div className="stat-card"><span className="stat-icon purple"><Folder size={16} /></span><span className="stat-number">{library.projects.length}</span><span className="stat-label">Projects</span></div>
              <div className="stat-card"><span className="stat-icon amber"><Heart size={16} /></span><span className="stat-number">{library.assets.filter((asset) => asset.favorite).length}</span><span className="stat-label">Favorites</span></div>
              <div className="stat-card"><span className="stat-icon green"><Clock3 size={16} /></span><span className="stat-number">{new Set(library.assets.map((asset) => asset.extension)).size}</span><span className="stat-label">File types</span></div>
            </div>

            <div className="category-row">
              <div className="category-tabs">{CATEGORIES.map((category) => <button key={category} className={activeCategory === category ? "active" : ""} onClick={() => setActiveCategory(category)}>{category === "Favorites" && <Star size={14} />}{category}<span className="tab-count">{category === "All assets" ? library.assets.length : category === "Favorites" ? library.assets.filter((asset) => asset.favorite).length : library.assets.filter((asset) => categoryOf(asset) === category).length}</span></button>)}</div>
              <div className="view-tools"><span className="result-count">{filtered.length} items</span><button className={`icon-button ${viewMode === "grid" ? "selected" : ""}`} title="Grid view" onClick={() => setViewMode("grid")}><Grid2X2 size={15} /></button><button className={`icon-button ${viewMode === "list" ? "selected" : ""}`} title="List view" onClick={() => setViewMode("list")}><ListFilter size={15} /></button><button className={`icon-button ${groupByProject ? "selected" : ""}`} title="Group by project" onClick={() => setGroupByProject((value) => !value)}><Layers3 size={15} /></button></div>
            </div>

            <div className="toolbar">
              <div className="search-box"><Search size={15} /><input placeholder="Search assets, projects, tags..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></div>
              <div className="toolbar-filter"><ListFilter size={14} /><span>{activeCollection === "all" ? "All collections" : activeCollection === "uncategorized" ? "Uncategorized" : activeCollection}</span><ChevronDown size={13} /></div>
              <button className="sort-button" onClick={() => setSortMode((value) => value === "name" ? "modified" : "name")}>{sortMode === "name" ? "Name A–Z" : "Recently modified"} <ChevronDown size={13} /></button>
            </div>

            <section className="asset-results">
              {loading ? <div className="empty-state"><span className="spinner" /><p>Loading your library...</p></div> :
                library.projects.length === 0 ? <div className="empty-state welcome-state"><div className="welcome-icon"><Layers3 size={28} /></div><h2>Your asset library starts here</h2><p>Add a Unity project folder, scan a parent folder, or clone a public GitHub repository.</p><div className="welcome-actions"><button className="primary-button" onClick={addFolder}><Plus size={15} /> Add project</button><button className="secondary-button" onClick={scanParent}><Search size={15} /> Scan for projects</button></div></div> :
                filtered.length === 0 ? <div className="empty-state"><div className="empty-icon"><Search size={22} /></div><h3>No matching assets</h3><p>Try a different search or category.</p></div> :
                groupByProject ? groupedAssets.map(([name, assets]) => <div className="asset-group" key={name}><h3><ChevronDown size={14} />{name}<span>{assets.length}</span></h3><AssetGrid assets={assets} viewMode={viewMode} selected={selected} onSelect={setSelected} onFavorite={(asset) => void updateMetadata(asset, { favorite: !asset.favorite })} /></div>) :
                <AssetGrid assets={filtered} viewMode={viewMode} selected={selected} onSelect={setSelected} onFavorite={(asset) => void updateMetadata(asset, { favorite: !asset.favorite })} />}
            </section>
          </div>
        </main>

        {selected && <aside className="inspector">
          <div className="inspector-header"><span>PREVIEW</span><button className="icon-button" onClick={() => setSelected(null)} title="Close preview"><X size={16} /></button></div>
          <div className="preview-region"><AssetPreview asset={selected} blenderPath={library.blenderPath} onConfigureBlender={chooseBlender} /></div>
          <div className="inspector-content">
            <div className="inspector-title-row"><div className="inspector-file-icon">{iconFor(selected)}</div><div className="inspector-title"><h2 title={selected.name}>{selected.name}</h2><span>.{selected.extension} asset</span></div><button className={`icon-button favorite-button ${selected.favorite ? "favorited" : ""}`} title={selected.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => void updateMetadata(selected, { favorite: !selected.favorite })}><Heart size={17} fill={selected.favorite ? "currentColor" : "none"} /></button></div>
            <div className="detail-section"><h3>DETAILS</h3><Detail label="Project" value={selected.projectName} /><Detail label="File size" value={formatSize(selected.size)} /><Detail label="Modified" value={formatDate(selected.modifiedAt)} /><Detail label="Location" value={selected.path} title={selected.path} /></div>
            <div className="detail-section tag-section"><div className="section-title-row"><h3>TAGS</h3><button className="text-button" onClick={() => setTagEditor((value) => !value)}>{tagEditor ? "Done" : "Edit"}</button></div><div className="tag-list">{selected.tags.length ? selected.tags.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>) : <span className="muted-text">No tags yet</span>}</div>{tagEditor && <TagInput asset={selected} onSave={(tags) => { void updateMetadata(selected, { tags }); setTagEditor(false); }} />}</div>
            <div className="detail-section"><div className="section-title-row"><h3>COLLECTION</h3><button className="text-button" onClick={() => setCollectionEditor((value) => !value)}>{collectionEditor ? "Done" : "Edit"}</button></div>{collectionEditor ? <CollectionInput asset={selected} onSave={(collection) => { void updateMetadata(selected, { collection }); setCollectionEditor(false); }} /> : <span className="muted-text">{selected.collection || "Uncategorized"}</span>}</div>
          </div>
          <div className="inspector-footer"><span className="status-dot" /> Indexed from {selected.projectName}</div>
        </aside>}
      </div>

      <footer className="statusbar"><div><span className="statusbar-brand"><Layers3 size={12} /> ASSET VAULT</span><span>{library.projects.length} projects</span><span>{library.assets.length} indexed files</span></div><div><span>Windows</span><span>Local index</span></div></footer>
      {toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
    </div>
  );
}

function GitHubMark() {
  return <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 .5a7.5 7.5 0 0 0-2.37 14.62c.38.07.51-.16.51-.36v-1.4c-2.08.45-2.52-.88-2.52-.88-.34-.86-.83-1.1-.83-1.1-.68-.46.05-.45.05-.45.75.05 1.14.77 1.14.77.67 1.14 1.75.81 2.18.62.07-.48.26-.81.47-1-1.66-.19-3.41-.83-3.41-3.7 0-.82.29-1.49.77-2.02-.08-.19-.33-.96.07-2 0 0 .63-.2 2.06.77a7.1 7.1 0 0 1 3.75 0c1.43-.97 2.06-.77 2.06-.77.4 1.04.15 1.81.07 2 .48.53.77 1.2.77 2.02 0 2.88-1.75 3.51-3.42 3.7.27.23.5.68.5 1.37v2.03c0 .2.13.44.52.36A7.5 7.5 0 0 0 8 .5Z" /></svg>;
}

function AssetGrid({ assets, viewMode, selected, onSelect, onFavorite }: {
  assets: Asset[];
  viewMode: "grid" | "list";
  selected: Asset | null;
  onSelect: (asset: Asset) => void;
  onFavorite: (asset: Asset) => void;
}) {
  return <div className={`asset-grid ${viewMode === "list" ? "list-view" : ""}`}>
    {assets.map((asset) => <AssetCard key={asset.path} asset={asset} selected={selected?.path === asset.path} onSelect={() => onSelect(asset)} onFavorite={() => onFavorite(asset)} />)}
  </div>;
}

function AssetCard({ asset, selected, onSelect, onFavorite }: { asset: Asset; selected: boolean; onSelect: () => void; onFavorite: () => void }) {
  const [thumbnail, setThumbnail] = useState("");
  useEffect(() => {
    let active = true;
    if (IMAGE_EXTENSIONS.has(asset.extension)) {
      void window.assetVault.getAssetUrl(asset.path).then((url) => { if (active) setThumbnail(url); }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [asset.path, asset.extension]);
  const isModel = MODEL_EXTENSIONS.has(asset.extension);
  return <article className={`asset-card ${selected ? "selected" : ""}`} onClick={onSelect} onDoubleClick={onSelect} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }}>
    <div className={`asset-card-preview ${IMAGE_EXTENSIONS.has(asset.extension) ? "image-preview" : ""}`}>
      {isModel
        ? <ModelThumbnail asset={asset} />
        : thumbnail ? <img src={thumbnail} alt="" /> : <div className={`file-type-icon ${categoryOf(asset).toLowerCase()}`}>{iconFor(asset)}<span>.{asset.extension}</span></div>}
      <button className={`card-favorite ${asset.favorite ? "active" : ""}`} title={asset.favorite ? "Remove favorite" : "Add favorite"} onClick={(event) => { event.stopPropagation(); onFavorite(); }}><Heart size={14} fill={asset.favorite ? "currentColor" : "none"} /></button>
      {asset.tags.length > 0 && <span className="card-tag">{asset.tags[0]}</span>}
    </div>
    <div className="asset-card-info"><div className="asset-name-row"><span className="asset-inline-icon">{iconFor(asset)}</span><strong title={asset.name}>{asset.name}</strong></div><div className="asset-meta"><span>{asset.projectName}</span><span>{formatSize(asset.size)}</span></div></div>
  </article>;
}

const modelThumbnailCache = new Map<string, string>();
let thumbnailRenderer: THREE.WebGLRenderer | null = null;
let thumbnailQueue: Promise<void> = Promise.resolve();

function requestModelThumbnail(asset: Asset): Promise<string> {
  const key = `${asset.path}:${asset.size}:${asset.modifiedAt}`;
  const cached = modelThumbnailCache.get(key);
  if (cached) return Promise.resolve(cached);

  const result = thumbnailQueue.then(async () => {
    const url = await window.assetVault.getModelPreviewUrl(asset.path);
    const extension = asset.extension === "blend" ? "glb" : asset.extension;
    let root: THREE.Object3D;

    if (extension === "obj") {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${asset.name} (${response.status}).`);
      root = new OBJLoader().parse(await response.text());
    } else if (extension === "fbx") {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${asset.name} (${response.status}).`);
      root = new FBXLoader().parse(await response.arrayBuffer(), `${url}/`);
    } else {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${asset.name} (${response.status}).`);
      const data = await response.arrayBuffer();
      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        new GLTFLoader().parse(data, `${url}/`, resolve, reject);
      });
      root = gltf.scene;
    }

    const canvas = document.createElement("canvas");
    if (!thumbnailRenderer) {
      thumbnailRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      thumbnailRenderer.setPixelRatio(1);
      thumbnailRenderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    thumbnailRenderer.setSize(144, 96, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#25262b");
    scene.add(new THREE.HemisphereLight(0xdce6ff, 0x47424f, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 5, 4);
    scene.add(light);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.Material) object.material.side = THREE.DoubleSide;
    });

    let dataUrl = "";
    try {
      const bounds = new THREE.Box3().setFromObject(root);
      if (bounds.isEmpty()) throw new Error("The model contains no visible geometry.");
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      root.position.sub(center);
      scene.add(root);
      const dimension = Math.max(size.x, size.y, size.z, 0.1);
      const camera = new THREE.PerspectiveCamera(42, 1.5, Math.max(dimension / 1000, 0.001), dimension * 100);
      camera.position.set(dimension * 1.8, dimension * 1.2, dimension * 2.1);
      camera.lookAt(0, 0, 0);
      thumbnailRenderer.render(scene, camera);
      dataUrl = thumbnailRenderer.domElement.toDataURL("image/jpeg", 0.8);
      modelThumbnailCache.set(key, dataUrl);
    } finally {
      scene.remove(root);
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    }
    return dataUrl;
  });

  thumbnailQueue = result.then(() => undefined, () => undefined);
  return result;
}

function ModelThumbnail({ asset }: { asset: Asset }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumbnail, setThumbnail] = useState(() => modelThumbnailCache.get(`${asset.path}:${asset.size}:${asset.modifiedAt}`) || "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || thumbnail) return;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void requestModelThumbnail(asset)
        .then((url) => { if (active) setThumbnail(url); })
        .catch(() => { if (active) setFailed(true); });
    }, { root: container.closest(".main-content"), rootMargin: "120px" });
    observer.observe(container);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [asset.path, asset.size, asset.modifiedAt, thumbnail]);

  return <div ref={containerRef} className={`model-thumbnail ${failed ? "failed" : ""}`}>
    {thumbnail ? <img src={thumbnail} alt={`${asset.name} model preview`} /> : failed ? <div className="file-type-icon models">{iconFor(asset)}<span>.{asset.extension}</span></div> : <div className="model-thumbnail-loading"><span className="spinner" /></div>}
  </div>;
}

function AssetPreview({ asset, blenderPath, onConfigureBlender }: { asset: Asset; blenderPath: string; onConfigureBlender: () => Promise<void> }) {
  if (MODEL_EXTENSIONS.has(asset.extension)) return <ModelPreview asset={asset} blenderPath={blenderPath} onConfigureBlender={onConfigureBlender} />;
  if (IMAGE_EXTENSIONS.has(asset.extension)) return <ImagePreview asset={asset} />;
  if (AUDIO_EXTENSIONS.has(asset.extension)) return <AudioPreview asset={asset} />;
  if (CODE_EXTENSIONS.has(asset.extension)) return <CodePreview asset={asset} />;
  return <div className="unsupported-preview"><PackageOpen size={30} /><span>No preview available</span></div>;
}

function ModelPreview({ asset, blenderPath, onConfigureBlender }: { asset: Asset; blenderPath: string; onConfigureBlender: () => Promise<void> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [clips, setClips] = useState<string[]>([]);
  const [selectedClip, setSelectedClip] = useState("");
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(true);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clipsRef = useRef<THREE.AnimationClip[]>([]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let frame = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let action: THREE.AnimationAction | null = null;
    let root: THREE.Object3D | null = null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#202125");
    scene.add(new THREE.HemisphereLight(0xc9d8ff, 0x32313d, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (reason) {
      setError(`Could not initialize the 3D viewer: ${reason instanceof Error ? reason.message : String(reason)}`);
      return () => {};
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
    camera.position.set(3.2, 2.2, 4.2);
    const controls = { dragging: false, x: 0, y: 0, yaw: Math.PI / 4, pitch: 0.32, distance: 5 };
    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const onDown = (event: PointerEvent) => { controls.dragging = true; controls.x = event.clientX; controls.y = event.clientY; canvas.setPointerCapture(event.pointerId); };
    const onMove = (event: PointerEvent) => {
      if (!controls.dragging) return;
      controls.yaw -= (event.clientX - controls.x) * 0.008;
      controls.pitch = THREE.MathUtils.clamp(controls.pitch + (event.clientY - controls.y) * 0.008, -1.2, 1.2);
      controls.x = event.clientX; controls.y = event.clientY;
    };
    const onUp = () => { controls.dragging = false; };
    const onWheel = (event: WheelEvent) => { controls.distance = THREE.MathUtils.clamp(controls.distance * (event.deltaY > 0 ? 1.1 : 0.9), 0.4, 40); };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: true });
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const load = async () => {
      setError("");
      setClips([]);
      setSelectedClip("");
      try {
        const url = await window.assetVault.getModelPreviewUrl(asset.path);
        const extension = asset.extension === "blend" ? "glb" : asset.extension;
        const animations: THREE.AnimationClip[] = [];
        const fetchModel = async (target: string) => {
          const response = await fetch(target);
          if (!response.ok) {
            const details = await response.text();
            throw new Error(details || `Could not load model (${response.status}).`);
          }
          return response;
        };
        if (extension === "fbx") {
          const response = await fetchModel(url);
          root = new FBXLoader().parse(await response.arrayBuffer(), `${url}/`);
          animations.push(...(root.animations || []));
        } else if (extension === "obj") {
          const response = await fetchModel(url);
          root = new OBJLoader().parse(await response.text());
        } else {
          const loader = new GLTFLoader();
          const response = await fetchModel(url);
          const data = await response.arrayBuffer();
          const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
            loader.parse(data, `${url}/`, resolve, reject);
          });
          root = gltf.scene;
          animations.push(...gltf.animations);
        }
        if (disposed || !root) return;
        root.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
            if (object.material instanceof THREE.Material) object.material.side = THREE.DoubleSide;
          }
        });
        const bounds = new THREE.Box3().setFromObject(root);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        root.position.sub(center);
        const maxDimension = Math.max(size.x, size.y, size.z, 0.1);
        controls.distance = maxDimension * 1.7;
        scene.add(root);
        camera.near = maxDimension / 1000;
        camera.far = maxDimension * 100;
        camera.updateProjectionMatrix();
        if (animations.length) {
          clipsRef.current = animations;
          setClips(animations.map((clip) => clip.name || "Animation"));
          mixer = new THREE.AnimationMixer(root);
          mixerRef.current = mixer;
          action = mixer.clipAction(animations[0]);
          action.play();
        }
        const clock = new THREE.Clock();
        const draw = () => {
          if (disposed) return;
          frame = requestAnimationFrame(draw);
          const delta = clock.getDelta();
          if (playingRef.current) mixer?.update(delta);
          const horizontal = controls.distance * Math.cos(controls.pitch);
          camera.position.set(controls.distance * Math.sin(controls.yaw) * Math.cos(controls.pitch), controls.distance * Math.sin(controls.pitch), horizontal * Math.cos(controls.yaw));
          camera.lookAt(0, 0, 0);
          renderer.render(scene, camera);
        };
        draw();
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void load();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      mixer?.stopAllAction();
      mixerRef.current = null;
      clipsRef.current = [];
      if (root) {
        scene.remove(root);
        root.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
        });
      }
      renderer.dispose();
    };
  }, [asset.path, asset.extension, blenderPath]);

  const changeClip = (name: string) => {
    setSelectedClip(name);
    setPlaying(true);
    const clip = clipsRef.current.find((item) => (item.name || "Animation") === name);
    if (clip && mixerRef.current) {
      const current = mixerRef.current;
      current.stopAllAction();
      current.clipAction(clip).reset().play();
    }
  };

  return <div className="model-preview">
    <canvas ref={canvasRef} />
    {error ?     <div className="preview-error"><Box size={22} /><span>{error}</span>{asset.extension === "blend" && <button className="text-button" onClick={() => void onConfigureBlender()}>Configure Blender</button>}</div> :
      <div className="model-controls">
        {clips.length > 0 ? <><button className="play-button" title={playing ? "Pause animation" : "Play animation"} onClick={() => setPlaying((value) => !value)}>{playing ? "Ⅱ" : "▶"}</button><select value={selectedClip || clips[0]} onChange={(event) => void changeClip(event.target.value)}>{clips.map((clip) => <option key={clip}>{clip}</option>)}</select></> : <span className="static-model-label">{asset.extension === "obj" ? "STATIC · OBJ" : "3D MODEL"}</span>}
        <span className="drag-hint">Drag to orbit · scroll to zoom</span>
      </div>}
  </div>;
}

function ImagePreview({ asset }: { asset: Asset }) {
  const [url, setUrl] = useState("");
  const [zoom, setZoom] = useState(100);
  const [columns, setColumns] = useState(1);
  const [rows, setRows] = useState(1);
  const [frame, setFrame] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isSprite = columns > 1 || rows > 1;
  useEffect(() => { let active = true; void window.assetVault.getAssetUrl(asset.path).then((next) => { if (active) setUrl(next); }).catch(() => undefined); return () => { active = false; }; }, [asset.path]);
  useEffect(() => {
    if (!url || !isSprite || !dimensions.width) return;
    const image = new window.Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cellWidth = image.width / columns;
      const cellHeight = image.height / rows;
      canvas.width = cellWidth;
      canvas.height = cellHeight;
      const context = canvas.getContext("2d");
      context?.drawImage(image, (frame % columns) * cellWidth, Math.floor(frame / columns) * cellHeight, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
    };
    image.src = url;
  }, [url, isSprite, columns, rows, frame, dimensions]);
  return <div className="image-preview-content">
    <div className="image-canvas">
      {url ? isSprite ? <canvas ref={canvasRef} style={{ maxWidth: `${zoom}%`, maxHeight: `${zoom}%` }} /> : <img src={url} alt={asset.name} style={{ maxWidth: `${zoom}%`, maxHeight: `${zoom}%` }} onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> : <Image size={26} />}
    </div>
    <div className="image-controls"><span>{dimensions.width ? `${dimensions.width} × ${dimensions.height}` : "Texture preview"}</span><label>Zoom <input type="range" min="25" max="200" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label></div>
    <div className="sprite-controls"><span>SPRITE SHEET</span><label>Cols <input type="number" min="1" max="64" value={columns} onChange={(event) => setColumns(Math.max(1, Number(event.target.value) || 1))} /></label><label>Rows <input type="number" min="1" max="64" value={rows} onChange={(event) => setRows(Math.max(1, Number(event.target.value) || 1))} /></label><button className="secondary-button compact" disabled={!isSprite} onClick={() => setFrame((value) => (value + 1) % (columns * rows))}>Frame {frame + 1} / {columns * rows}</button></div>
  </div>;
}

function AudioPreview({ asset }: { asset: Asset }) {
  const [url, setUrl] = useState("");
  useEffect(() => { let active = true; void window.assetVault.getAssetUrl(asset.path).then((next) => { if (active) setUrl(next); }).catch(() => undefined); return () => { active = false; }; }, [asset.path]);
  return <div className="audio-preview"><div className="audio-art"><AudioLines size={31} /></div><strong>{asset.name}</strong><span>Audio preview</span>{url && <audio controls preload="metadata" src={url}>Your browser does not support audio playback.</audio>}</div>;
}

function languageFor(extension: string) {
  if (["cs", "shader", "compute", "hlsl", "cginc", "glsl"].includes(extension)) return "csharp";
  if (extension === "js") return "javascript";
  if (extension === "ts") return "typescript";
  if (extension === "json") return "json";
  if (extension === "xml") return "xml";
  if (["yaml", "yml"].includes(extension)) return "yaml";
  return "";
}

function CodePreview({ asset }: { asset: Asset }) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setContent("");
    setError("");
    void window.assetVault.readText(asset.path).then((text) => { if (active) setContent(text); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [asset.path]);
  const highlighted = useMemo(() => {
    const language = languageFor(asset.extension);
    if (!language || !content) return null;
    try { return hljs.highlight(content, { language }).value; } catch { return null; }
  }, [asset.extension, content]);
  return <div className="code-preview"><div className="code-preview-header"><Braces size={15} /><span>{asset.name}</span><span className="code-language">{asset.extension.toUpperCase()}</span></div>{error ? <div className="preview-error">{error}</div> : <pre><code className={highlighted ? "hljs" : ""} dangerouslySetInnerHTML={{ __html: highlighted || escapeHtml(content) }} /></pre>}</div>;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function Detail({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="detail-row"><span>{label}</span><strong title={title || value}>{value}</strong></div>;
}

function TagInput({ asset, onSave }: { asset: Asset; onSave: (tags: string[]) => void }) {
  const [value, setValue] = useState(asset.tags.join(", "));
  return <form className="inline-edit" onSubmit={(event) => { event.preventDefault(); onSave([...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))]); }}><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. environment, stylized" /><button className="text-button">Save</button></form>;
}

function CollectionInput({ asset, onSave }: { asset: Asset; onSave: (collection: string) => void }) {
  const [value, setValue] = useState(asset.collection);
  return <form className="inline-edit" onSubmit={(event) => { event.preventDefault(); onSave(value.trim()); }}><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="Collection name" list="collection-options" /><datalist id="collection-options" /><button className="text-button">Save</button></form>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
