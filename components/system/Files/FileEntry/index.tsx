import { Down } from "components/apps/FileExplorer/NavigationIcons";
import extensions from "components/system/Files/FileEntry/extensions";
import {
  getModifiedTime,
  getTextWrapData,
} from "components/system/Files/FileEntry/functions";
import useFile from "components/system/Files/FileEntry/useFile";
import useFileContextMenu from "components/system/Files/FileEntry/useFileContextMenu";
import useFileInfo from "components/system/Files/FileEntry/useFileInfo";
import FileManager from "components/system/Files/FileManager";
import type { FileStat } from "components/system/Files/FileManager/functions";
import { isSelectionIntersecting } from "components/system/Files/FileManager/Selection/functions";
import type { SelectionRect } from "components/system/Files/FileManager/Selection/useSelection";
import useFileDrop from "components/system/Files/FileManager/useFileDrop";
import type { FocusEntryFunctions } from "components/system/Files/FileManager/useFocusableEntries";
import type { FileActions } from "components/system/Files/FileManager/useFolder";
import type { FileManagerViewNames } from "components/system/Files/Views";
import { FileEntryIconSize } from "components/system/Files/Views";
import { useFileSystem } from "contexts/fileSystem";
import { useProcesses } from "contexts/process";
import { m as motion } from "framer-motion";
import useDoubleClick from "hooks/useDoubleClick";
import dynamic from "next/dynamic";
import { basename, dirname, extname, join } from "path";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "styled-components";
import Button from "styles/common/Button";
import Icon from "styles/common/Icon";
import {
  DEFAULT_LOCALE,
  FOLDER_BACK_ICON,
  FOLDER_FRONT_ICON,
  ICON_CACHE,
  ICON_CACHE_EXTENSION,
  ICON_PATH,
  IMAGE_FILE_EXTENSIONS,
  MOUNTABLE_EXTENSIONS,
  NON_BREAKING_HYPHEN,
  ONE_TIME_PASSIVE_EVENT,
  PREVENT_SCROLL,
  SHORTCUT_EXTENSION,
  SHORTCUT_ICON,
  SMALLEST_PNG_SIZE,
  USER_ICON_PATH,
  VIDEO_FILE_EXTENSIONS,
} from "utils/constants";
import {
  bufferToUrl,
  getFormattedSize,
  isCanvasEmpty,
  isYouTubeUrl,
} from "utils/functions";
import { spotlightEffect } from "utils/spotlightEffect";

const RenameBox = dynamic(
  () => import("components/system/Files/FileEntry/RenameBox")
);

type FileEntryProps = {
  fileActions: FileActions;
  fileManagerId?: string;
  fileManagerRef: React.MutableRefObject<HTMLOListElement | null>;
  focusFunctions: FocusEntryFunctions;
  focusedEntries: string[];
  hideShortcutIcon?: boolean;
  isLoadingFileManager: boolean;
  loadIconImmediately?: boolean;
  name: string;
  path: string;
  readOnly?: boolean;
  renaming: boolean;
  selectionRect?: SelectionRect;
  setRenaming: React.Dispatch<React.SetStateAction<string>>;
  stats: FileStat;
  useNewFolderIcon?: boolean;
  view: FileManagerViewNames;
};

const truncateName = (
  name: string,
  fontSize: string,
  fontFamily: string,
  maxWidth: number
): string => {
  const nonBreakingName = name.replace(/-/g, NON_BREAKING_HYPHEN);
  const { lines } = getTextWrapData(
    nonBreakingName,
    fontSize,
    fontFamily,
    maxWidth
  );

  if (lines.length > 2) {
    const text = !name.includes(" ") ? lines[0] : lines.slice(0, 2).join("");

    return `${text.slice(0, -3)}...`;
  }

  return nonBreakingName;
};

const focusing: string[] = [];

const cacheQueue: (() => Promise<void>)[] = [];

const FileEntry: FC<FileEntryProps> = ({
  fileActions,
  fileManagerId,
  fileManagerRef,
  focusedEntries,
  focusFunctions,
  hideShortcutIcon,
  isLoadingFileManager,
  loadIconImmediately,
  name,
  path,
  readOnly,
  renaming,
  selectionRect,
  setRenaming,
  stats,
  useNewFolderIcon,
  view,
}) => {
  const { blurEntry, focusEntry } = focusFunctions;
  const { url: changeUrl } = useProcesses();
  const [{ comment, getIcon, icon, pid, subIcons, url }, setInfo] = useFileInfo(
    path,
    stats.isDirectory(),
    useNewFolderIcon
  );
  const openFile = useFile(url);
  const {
    createPath,
    exists,
    mkdirRecursive,
    pasteList,
    readFile,
    stat,
    unlink,
    updateFolder,
    writeFile,
  } = useFileSystem();
  const [showInFileManager, setShowInFileManager] = useState(false);
  const { formats, sizes } = useTheme();
  const listView = view === "list";
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const figureRef = useRef<HTMLElement | null>(null);
  const fileName = basename(path);
  const urlExt = extname(url).toLowerCase();
  const isDynamicIcon =
    IMAGE_FILE_EXTENSIONS.has(urlExt) ||
    VIDEO_FILE_EXTENSIONS.has(urlExt) ||
    isYouTubeUrl(url);
  const filteredSubIcons = (
    hideShortcutIcon || stats.systemShortcut
      ? subIcons?.filter((iconEntry) => iconEntry !== SHORTCUT_ICON)
      : subIcons
  )?.filter((subIcon) => subIcon !== icon);
  const isOnlyFocusedEntry =
    focusedEntries.length === 1 && focusedEntries[0] === fileName;
  const extension = extname(path).toLowerCase();
  const isShortcut = extension === SHORTCUT_EXTENSION;
  const directory = isShortcut ? url : path;
  const fileDrop = useFileDrop({
    callback: async (fileDropName, data) => {
      if (!focusedEntries.includes(fileName)) {
        const uniqueName = await createPath(fileDropName, directory, data);

        if (uniqueName) updateFolder(directory, uniqueName);
      }
    },
    directory,
    onDragLeave: () =>
      buttonRef.current?.parentElement?.classList.remove("focus-within"),
    onDragOver: () =>
      buttonRef.current?.parentElement?.classList.add("focus-within"),
  });
  const openInFileExplorer = pid === "FileExplorer";
  const truncatedName = useMemo(
    () =>
      truncateName(
        name,
        sizes.fileEntry.fontSize,
        formats.systemFont,
        sizes.fileEntry[
          listView ? "maxListTextDisplayWidth" : "maxIconTextDisplayWidth"
        ]
      ),
    [formats.systemFont, listView, name, sizes.fileEntry]
  );
  const iconRef = useRef<HTMLImageElement | null>(null);
  const isIconCached = useRef(false);
  const isDynamicIconLoaded = useRef(false);
  const getIconAbortController = useRef<AbortController>();
  const createTooltip = useCallback(async (): Promise<string> => {
    if (stats.isDirectory()) return "";

    if (isShortcut) {
      if (comment) return comment;
      if (url) {
        if (url.startsWith("http:") || url.startsWith("https:")) return url;
        return `Location: ${basename(url, extname(url))} (${dirname(url)})`;
      }
      return "";
    }

    const type =
      extensions[extension]?.type ||
      `${extension.toUpperCase().replace(".", "")} File`;
    const fullStats = stats.size < 0 ? await stat(path) : stats;
    const { size: sizeInBytes } = fullStats;
    const modifiedTime = getModifiedTime(path, fullStats);
    const size = getFormattedSize(sizeInBytes);
    const toolTip = `Type: ${type}${size !== "-1" ? `\nSize: ${size}` : ""}`;
    const date = new Date(modifiedTime).toISOString().slice(0, 10);
    const time = new Intl.DateTimeFormat(
      DEFAULT_LOCALE,
      formats.dateModified
    ).format(modifiedTime);
    const dateModified = `${date} ${time}`;

    return `${toolTip}\nDate modified: ${dateModified}`;
  }, [
    comment,
    extension,
    formats.dateModified,
    isShortcut,
    path,
    stat,
    stats,
    url,
  ]);
  const [tooltip, setTooltip] = useState<string>();

  useEffect(() => {
    const updateIcon = async (): Promise<void> => {
      if (!isLoadingFileManager && !isIconCached.current) {
        if (icon.startsWith("blob:") || icon.startsWith("data:")) {
          if (icon.startsWith("data:image/jpeg;base64,")) return;

          isIconCached.current = true;

          const cachedIconPath = join(
            ICON_CACHE,
            `${path}${ICON_CACHE_EXTENSION}`
          );

          if (
            urlExt !== ".ico" &&
            !url.startsWith(ICON_PATH) &&
            !url.startsWith(USER_ICON_PATH) &&
            !(await exists(cachedIconPath)) &&
            iconRef.current instanceof HTMLImageElement
          ) {
            const cacheIcon = async (): Promise<void> => {
              if (iconRef.current instanceof HTMLImageElement) {
                const nextQueueItem = (): Promise<void> => {
                  cacheQueue.shift();
                  return cacheQueue[0]?.();
                };
                let generatedIcon: string;

                if (
                  iconRef.current.currentSrc.startsWith(
                    "data:image/gif;base64,"
                  )
                ) {
                  generatedIcon = iconRef.current.currentSrc;
                } else {
                  const htmlToImage = await import("html-to-image");
                  const iconCanvas = await htmlToImage.toCanvas(
                    iconRef.current,
                    {
                      skipAutoScale: true,
                    }
                  );

                  if (!isCanvasEmpty(iconCanvas)) {
                    generatedIcon = iconCanvas.toDataURL("image/png");
                  }
                }

                cacheQueue.push(async () => {
                  if (!generatedIcon) return nextQueueItem();

                  const baseCachedPath = dirname(cachedIconPath);

                  await mkdirRecursive(baseCachedPath);

                  const cachedIcon = Buffer.from(
                    generatedIcon.replace(/data:(.*);base64,/, ""),
                    "base64"
                  );

                  await writeFile(cachedIconPath, cachedIcon, true);
                  setInfo((info) => ({
                    ...info,
                    icon: bufferToUrl(cachedIcon),
                  }));
                  updateFolder(baseCachedPath, basename(cachedIconPath));

                  return nextQueueItem();
                });

                if (cacheQueue.length === 1) await cacheQueue[0]();
              }
            };

            if (iconRef.current.complete) cacheIcon();
            else {
              iconRef.current.addEventListener(
                "load",
                cacheIcon,
                ONE_TIME_PASSIVE_EVENT
              );
            }
          }
        } else if (getIcon) {
          const cachedIconPath = join(
            ICON_CACHE,
            `${path}${ICON_CACHE_EXTENSION}`
          );

          if (await exists(cachedIconPath)) {
            isIconCached.current = true;

            const cachedIconData = await readFile(cachedIconPath);

            if (cachedIconData.length >= SMALLEST_PNG_SIZE) {
              setInfo((info) => ({
                ...info,
                icon: bufferToUrl(cachedIconData),
              }));
            } else {
              try {
                await unlink(cachedIconPath);
                updateFolder(dirname(path));
              } catch {
                // Ignore issues deleting bad cached icon
              }
            }
          } else if (
            !isDynamicIconLoaded.current &&
            buttonRef.current &&
            typeof getIcon === "function"
          ) {
            isDynamicIconLoaded.current = true;
            new IntersectionObserver(
              ([{ intersectionRatio }], observer) => {
                if (intersectionRatio > 0) {
                  observer.disconnect();
                  getIconAbortController.current = new AbortController();
                  getIcon(getIconAbortController.current.signal);
                }
              },
              { root: fileManagerRef.current, rootMargin: "5px" }
            ).observe(buttonRef.current);
          }
        }
      }
    };

    updateIcon();
  }, [
    exists,
    fileManagerRef,
    getIcon,
    icon,
    isLoadingFileManager,
    mkdirRecursive,
    path,
    readFile,
    setInfo,
    stats.mtime,
    unlink,
    updateFolder,
    url,
    urlExt,
    writeFile,
  ]);

  useEffect(
    () => () => {
      try {
        getIconAbortController?.current?.abort?.();
      } catch {
        // Failed to abort getIcon
      }
    },
    []
  );

  useEffect(() => {
    if (buttonRef.current) {
      const inFocusedEntries = focusedEntries.includes(fileName);
      const inFocusing = focusing.includes(fileName);
      const isFocused = inFocusedEntries || inFocusing;

      if (inFocusedEntries && inFocusing) {
        focusing.splice(focusing.indexOf(fileName), 1);
      }

      if (selectionRect && fileManagerRef.current) {
        const selected = isSelectionIntersecting(
          buttonRef.current.getBoundingClientRect(),
          fileManagerRef.current.getBoundingClientRect(),
          selectionRect,
          fileManagerRef.current.scrollTop
        );

        if (selected && !isFocused) {
          focusing.push(fileName);
          focusEntry(fileName);
          buttonRef.current.focus(PREVENT_SCROLL);
        } else if (!selected && isFocused) {
          blurEntry(fileName);
        }
      } else if (
        isFocused &&
        focusedEntries.length === 1 &&
        !buttonRef.current.contains(document.activeElement)
      ) {
        blurEntry();
        focusEntry(fileName);
        buttonRef.current.focus(PREVENT_SCROLL);
      }
    }
  }, [
    blurEntry,
    fileManagerRef,
    fileName,
    focusEntry,
    focusedEntries,
    selectionRect,
  ]);

  return (
    <>
      <Button
        {...(listView && {
          animate: { opacity: 1 },
          as: motion.button,
          initial: { opacity: 0 },
          transition: { duration: 0.15 },
        })}
        ref={buttonRef}
        aria-label={name}
        onMouseOver={() => createTooltip().then(setTooltip)}
        title={tooltip}
        {...useDoubleClick(() => {
          if (
            openInFileExplorer &&
            fileManagerId &&
            !MOUNTABLE_EXTENSIONS.has(urlExt)
          ) {
            changeUrl(fileManagerId, url);
            blurEntry();
          } else if (openInFileExplorer && listView) {
            setShowInFileManager((currentState) => !currentState);
          } else {
            openFile(pid, !isDynamicIcon ? icon : undefined);
          }
        }, listView)}
        {...(openInFileExplorer && fileDrop)}
        {...useFileContextMenu(
          url,
          pid,
          path,
          setRenaming,
          fileActions,
          focusFunctions,
          focusedEntries,
          fileManagerId,
          readOnly
        )}
      >
        <figure
          ref={figureRef}
          style={renaming ? { pointerEvents: "all" } : undefined}
          {...(listView && spotlightEffect(figureRef.current))}
        >
          <Icon
            $eager={loadIconImmediately}
            $imgRef={iconRef}
            $moving={pasteList[path] === "move"}
            alt={name}
            src={icon}
            {...FileEntryIconSize[view]}
          />
          {(filteredSubIcons || []).map((entryIcon, subIconIndex) => (
            <Icon
              key={entryIcon}
              $eager={entryIcon === SHORTCUT_ICON}
              alt={name}
              src={entryIcon}
              style={
                icon === FOLDER_BACK_ICON && entryIcon !== FOLDER_FRONT_ICON
                  ? {
                      transform:
                        subIconIndex === 0
                          ? "matrix(0, 1.8, 1.8, 0.2, 1.2, 2) scaleX(-1) scale(0.4) translateZ(0px)"
                          : "matrix(0, 1.8, 1.2, 0.4, -4, 4) scaleX(-1) scale(0.4) translateZ(0px)",
                    }
                  : {}
              }
              {...FileEntryIconSize[
                ![SHORTCUT_ICON, FOLDER_FRONT_ICON].includes(entryIcon) &&
                !entryIcon.startsWith("blob:")
                  ? "sub"
                  : view
              ]}
            />
          ))}
          {renaming ? (
            <RenameBox
              name={name}
              path={path}
              renameFile={(origPath, newName) => {
                fileActions.renameFile(origPath, newName);
                setRenaming("");
              }}
            />
          ) : (
            <figcaption>
              {!isOnlyFocusedEntry || name.length === truncatedName.length
                ? truncatedName
                : name}
            </figcaption>
          )}
          {listView && openInFileExplorer && <Down flip={showInFileManager} />}
        </figure>
      </Button>
      {showInFileManager && (
        <FileManager
          url={url}
          view="list"
          hideFolders
          hideLoading
          hideShortcutIcons
          loadIconsImmediately
          readOnly
        />
      )}
    </>
  );
};

export default FileEntry;
