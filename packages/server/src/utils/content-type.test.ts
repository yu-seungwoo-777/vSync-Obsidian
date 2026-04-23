import { describe, it, expect } from "vitest";
import { guessContentType, isImageFile } from "./content-type.js";

describe("guessContentType", () => {
  describe("image types", () => {
    it("should return image/png for .png extension", () => {
      expect(guessContentType("photo.png")).toBe("image/png");
    });

    it("should return image/jpeg for .jpg extension", () => {
      expect(guessContentType("photo.jpg")).toBe("image/jpeg");
    });

    it("should return image/jpeg for .jpeg extension", () => {
      expect(guessContentType("photo.jpeg")).toBe("image/jpeg");
    });

    it("should return image/gif for .gif extension", () => {
      expect(guessContentType("animation.gif")).toBe("image/gif");
    });

    it("should return image/svg+xml for .svg extension", () => {
      expect(guessContentType("logo.svg")).toBe("image/svg+xml");
    });

    it("should return image/webp for .webp extension", () => {
      expect(guessContentType("image.webp")).toBe("image/webp");
    });
  });

  describe("document types", () => {
    it("should return application/pdf for .pdf extension", () => {
      expect(guessContentType("document.pdf")).toBe("application/pdf");
    });

    it("should return application/zip for .zip extension", () => {
      expect(guessContentType("archive.zip")).toBe("application/zip");
    });
  });

  describe("audio/video types", () => {
    it("should return audio/mpeg for .mp3 extension", () => {
      expect(guessContentType("song.mp3")).toBe("audio/mpeg");
    });

    it("should return video/mp4 for .mp4 extension", () => {
      expect(guessContentType("video.mp4")).toBe("video/mp4");
    });

    it("should return audio/wav for .wav extension", () => {
      expect(guessContentType("audio.wav")).toBe("audio/wav");
    });

    it("should return audio/ogg for .ogg extension", () => {
      expect(guessContentType("sound.ogg")).toBe("audio/ogg");
    });
  });

  describe("unknown types", () => {
    it("should return application/octet-stream for unknown extension", () => {
      expect(guessContentType("file.xyz")).toBe("application/octet-stream");
    });

    it("should return application/octet-stream for .txt extension", () => {
      expect(guessContentType("readme.txt")).toBe("application/octet-stream");
    });

    it("should return application/octet-stream for .exe extension", () => {
      expect(guessContentType("program.exe")).toBe("application/octet-stream");
    });
  });

  describe("case insensitivity", () => {
    it("should handle .PNG (uppercase) correctly", () => {
      expect(guessContentType("photo.PNG")).toBe("image/png");
    });

    it("should handle .JPG (uppercase) correctly", () => {
      expect(guessContentType("photo.JPG")).toBe("image/jpeg");
    });

    it("should handle .Pdf (mixed case) correctly", () => {
      expect(guessContentType("doc.Pdf")).toBe("application/pdf");
    });

    it("should handle .MP4 (uppercase) correctly", () => {
      expect(guessContentType("video.MP4")).toBe("video/mp4");
    });

    it("should handle .SVG (uppercase) correctly", () => {
      expect(guessContentType("icon.SVG")).toBe("image/svg+xml");
    });
  });

  describe("edge cases", () => {
    it("should return application/octet-stream for file with no extension", () => {
      expect(guessContentType("README")).toBe("application/octet-stream");
    });

    it("should return application/octet-stream for empty string", () => {
      expect(guessContentType("")).toBe("application/octet-stream");
    });

    it("should handle paths with directories", () => {
      expect(guessContentType("folder/subfolder/photo.png")).toBe("image/png");
    });

    it("should handle files with multiple dots", () => {
      expect(guessContentType("archive.backup.zip")).toBe("application/zip");
    });

    it("should handle extension appearing in middle of filename", () => {
      expect(guessContentType("png_data.json")).toBe("application/octet-stream");
    });
  });
});

describe("isImageFile", () => {
  describe("image files", () => {
    it("should return true for .png files", () => {
      expect(isImageFile("photo.png")).toBe(true);
    });

    it("should return true for .jpg files", () => {
      expect(isImageFile("photo.jpg")).toBe(true);
    });

    it("should return true for .jpeg files", () => {
      expect(isImageFile("photo.jpeg")).toBe(true);
    });

    it("should return true for .gif files", () => {
      expect(isImageFile("animation.gif")).toBe(true);
    });

    it("should return true for .svg files", () => {
      expect(isImageFile("logo.svg")).toBe(true);
    });

    it("should return true for .webp files", () => {
      expect(isImageFile("image.webp")).toBe(true);
    });
  });

  describe("non-image files", () => {
    it("should return false for .pdf files", () => {
      expect(isImageFile("document.pdf")).toBe(false);
    });

    it("should return false for .mp3 files", () => {
      expect(isImageFile("song.mp3")).toBe(false);
    });

    it("should return false for .mp4 files", () => {
      expect(isImageFile("video.mp4")).toBe(false);
    });

    it("should return false for files with no extension", () => {
      expect(isImageFile("README")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isImageFile("")).toBe(false);
    });
  });

  describe("case insensitivity", () => {
    it("should handle uppercase .PNG", () => {
      expect(isImageFile("photo.PNG")).toBe(true);
    });

    it("should handle uppercase .JPG", () => {
      expect(isImageFile("photo.JPG")).toBe(true);
    });

    it("should handle uppercase .WEBP", () => {
      expect(isImageFile("photo.WEBP")).toBe(true);
    });
  });
});
