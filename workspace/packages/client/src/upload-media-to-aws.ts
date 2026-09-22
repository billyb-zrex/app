import api from '@fable/common/dist/api';
import raiseDeferredError from '@fable/common/dist/deferred-error';
import {
  RespMediaProcessingInfo,
  ReqMediaProcessing,
  ApiResp,
  RespUploadUrl,
  ResponseStatus,
  PvtAssetType,
  EntityType
} from '@fable/common/dist/api-contract';
import { captureException } from '@sentry/react';

export const signedUploadHeaders = (url: string, contentType: string): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (new URL(url).searchParams.get('x-amz-acl') === 'public-read') {
    headers['x-amz-acl'] = 'public-read';
  }
  return headers;
};

export const getS3UploadUrl = async (type: string): Promise<{
  baseUrl: string;
  cdnUrl: string
} | null> => {
  const res = await api<null, ApiResp<RespUploadUrl>>(`/getuploadlink?te=${btoa(type)}`, {
    auth: true,
  });

  if (res.status === ResponseStatus.Failure) {
    captureException('Error in getting S3 upload url');
  }
  return res.status === ResponseStatus.Failure ? null : {
    baseUrl: res.data.url,
    cdnUrl: res.data.cdnPath
  };
};

export async function uploadMediaToAws(
  mediaBuffer: Uint8Array,
  type: 'video/webm' | 'video/mp4' | 'audio/webm'
) {
  const awsSignedUrl = await getS3UploadUrl(type);
  if (!awsSignedUrl) return awsSignedUrl;

  await fetch(awsSignedUrl.baseUrl, {
    method: 'PUT',
    body: mediaBuffer,
    headers: signedUploadHeaders(awsSignedUrl.baseUrl, type),
  });
  return awsSignedUrl;
}

// TODO[now] have to return both cdn url and processed url
export async function uploadImageDataToAws(base64ImageData: string, type: 'image/png') {
  const awsSignedUrl = await getS3UploadUrl(type);
  if (!awsSignedUrl) return awsSignedUrl;

  const imageData = base64ImageData.replace(/^data:image\/\w+;base64,/, '');
  const byteCharacters = atob(imageData);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);

  const res = await fetch(awsSignedUrl.baseUrl, {
    method: 'PUT',
    body: byteArray,
    headers: signedUploadHeaders(awsSignedUrl.baseUrl, type),
  });

  if (res.status === 200) {
    return awsSignedUrl;
  }
  raiseDeferredError(new Error(`Failed to upload image to AWS. Status ${res.status}`));
  return null;
}

export const uploadImageAsBinary = async (selectedImage: any, presignedUrls: {
  baseUrl: string,
  cdnUrl: string
}): Promise<string> => {
  const reader = new FileReader();
  reader.readAsArrayBuffer(selectedImage);
  return new Promise((resolve) => {
    reader.addEventListener('load', async () => {
      const binaryData = reader.result;
      const res = await fetch(presignedUrls.baseUrl, {
        method: 'PUT',
        body: binaryData,
        headers: signedUploadHeaders(presignedUrls.baseUrl, selectedImage.type),
      });

      if (res.status === 200) {
        resolve(presignedUrls.cdnUrl);
      }
    });
  });
};

export const uploadMarkedImageToAws = async (
  contentType: string,
  anonDemoId: string,
  imageName: string,
  file: File
): Promise<string> => {
  // eslint-disable-next-line max-len
  const data = await api<null, ApiResp<RespUploadUrl>>(`/getpvtuploadlink?te=${btoa(contentType)}&pre=${anonDemoId}&fe=${btoa(imageName)}&t=${PvtAssetType.MarkedImgs}`, {
    auth: true
  });
  if (data.status === ResponseStatus.Failure) {
    captureException('Error in getting S3 upload url');
    return '';
  }

  const s3PresignedUploadUrl = data.data.url;
  const imageUrl = await uploadImageAsBinary(file, {
    baseUrl: s3PresignedUploadUrl,
    cdnUrl: s3PresignedUploadUrl.split('?')[0]
  });
  return imageUrl;
};

export async function uploadImgFileObjectToAws(image: File) {
  if (!image) {
    return null;
  }
  const awsSignedUrl = await getS3UploadUrl(image.type);
  if (!awsSignedUrl) return awsSignedUrl;

  await uploadImageAsBinary(image, awsSignedUrl);
  return awsSignedUrl;
}

export async function transcodeVideo(uri: string, cdnUrl: string, tourRid: string):
  Promise<[err: string, ...streams: RespMediaProcessingInfo[]]> {
  const data = await api<ReqMediaProcessing, ApiResp<RespMediaProcessingInfo[]>>('/vdt', {
    auth: true,
    body: {
      cdnPath: cdnUrl,
      path: uri,
      assn: {
        entityRid: tourRid,
        entityType: EntityType.Tour
      }
    }
  });
  if (data.status === ResponseStatus.Failure) {
    return ["Couldn't transcode video"];
  }
  return ['', ...data.data];
}

export async function transcodeAudio(uri: string, cdnUrl: string, tourRid: string):
  Promise<[err: string, ...streams: RespMediaProcessingInfo[]]> {
  const data = await api<ReqMediaProcessing, ApiResp<RespMediaProcessingInfo[]>>('/audt', {
    auth: true,
    body: {
      path: uri,
      cdnPath: cdnUrl,
      assn: {
        entityRid: tourRid,
        entityType: EntityType.Tour
      }
    }
  });
  if (data.status === ResponseStatus.Failure) {
    return ["Couldn't transcode audio"];
  }
  return ['', ...data.data];
}

