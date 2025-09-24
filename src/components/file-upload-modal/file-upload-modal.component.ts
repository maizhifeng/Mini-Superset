import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { DatabaseService } from '../../services/database.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-file-upload-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-upload-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FileUploadModalComponent {
  databaseService = inject(DatabaseService);
  
  isOpen = signal(false);
  fileToUpload = signal<File | null>(null);
  fileEncoding = signal<'utf-8' | 'gbk'>('utf-8');

  public open(): void {
    this.isOpen.set(true);
    this.fileToUpload.set(null);
  }

  close(): void {
    this.isOpen.set(false);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.fileToUpload.set(input.files[0]);
    }
  }

  handleUpload(): void {
    const file = this.fileToUpload();
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: any) => {
      const text = new TextDecoder(this.fileEncoding()).decode(e.target.result);
      this.databaseService.processAndLoadData(text, file.name, 'uploaded')
        .then(() => this.close())
        .catch(err => console.error(err));
    };
    reader.onerror = () => {
      this.databaseService.error.set('读取文件时出错。');
      this.close();
    };
    reader.readAsArrayBuffer(file);
  }
}