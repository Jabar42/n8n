import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { STORES } from '@/constants';
import type { FolderCreateResponse, FolderShortInfo, FolderTreeResponseItem } from '@/Interface';
import * as workflowsApi from '@/api/workflows';
import { useRootStore } from './root.store';

export const useFoldersStore = defineStore(STORES.FOLDERS, () => {
	const rootStore = useRootStore();

	const currentFolderId = ref<string | null>(null);

	/**
	 * Cache visited folders so we can build breadcrumbs paths without fetching them from the server
	 */
	const breadcrumbsCache = ref<Record<string, FolderShortInfo>>({});

	const currentFolderInfo = computed(() => {
		return currentFolderId.value ? breadcrumbsCache.value[currentFolderId.value] : null;
	});

	const cacheFolders = (folders: FolderShortInfo[]) => {
		folders.forEach((folder) => {
			if (!breadcrumbsCache.value[folder.id]) {
				breadcrumbsCache.value[folder.id] = {
					id: folder.id,
					name: folder.name,
					parentFolder: folder.parentFolder,
				};
			}
		});
	};

	const getCachedFolder = (folderId: string) => {
		return breadcrumbsCache.value[folderId];
	};

	async function createFolder(
		name: string,
		projectId: string,
		parentFolderId?: string,
	): Promise<FolderCreateResponse> {
		return await workflowsApi.createFolder(
			rootStore.restApiContext,
			projectId,
			name,
			parentFolderId,
		);
	}

	async function getFolderPath(
		projectId: string,
		folderId: string,
	): Promise<FolderTreeResponseItem[]> {
		const tree = await workflowsApi.getFolderPath(rootStore.restApiContext, projectId, folderId);
		const forCache = extractFoldersForCache(tree);
		cacheFolders(forCache);
		currentFolderId.value = folderId;

		return tree;
	}

	function extractFoldersForCache(
		items: FolderTreeResponseItem[],
		parentFolderId?: string,
	): FolderShortInfo[] {
		let result: FolderShortInfo[] = [];

		items.forEach((item) => {
			// Add current item to result
			result.push({
				id: item.id,
				name: item.name,
				parentFolder: parentFolderId,
			});

			// Process children recursively
			if (item.children && item.children.length > 0) {
				const childFolders = extractFoldersForCache(item.children, item.id);
				result = [...result, ...childFolders];
			}
		});

		return result;
	}

	return {
		currentFolderId,
		breadcrumbsCache,
		currentFolderInfo,
		cacheFolders,
		getCachedFolder,
		createFolder,
		getFolderPath,
	};
});
