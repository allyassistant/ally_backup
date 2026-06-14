#!/usr/bin/env python3
"""
Sticker Skill Universal - 通用貼圖處理工具

功能：
- 自動檢測背景顏色（純色/格子/多色）
- 支持任何顏色的背景去除
- 智能判斷背景類型

作者: Kimi
版本: 2.1.0
"""

from PIL import Image
import numpy as np
from pathlib import Path
from collections import Counter
from typing import List, Tuple, Optional, Union


class UniversalBackgroundRemover:
    """通用背景去除器 - 自動檢測並去除各種背景"""
    
    def __init__(self, 
                 color_tolerance: int = 25,
                 min_background_ratio: float = 0.05,
                 edge_margin: int = 5):
        """
        初始化
        
        Args:
            color_tolerance: 顏色相似度容忍度（0-255）
            min_background_ratio: 最小背景比例（用於過濾小區域）
            edge_margin: 邊緣檢測邊距（像素）
        """
        self.color_tolerance = color_tolerance
        self.min_background_ratio = min_background_ratio
        self.edge_margin = edge_margin
    
    def detect_background_colors(self, image: Image.Image) -> List[Tuple[int, int, int]]:
        """
        自動檢測背景顏色
        
        策略：
        1. 分析圖片邊緣區域的顏色
        2. 找出最常見的顏色
        3. 合併相似的顏色
        
        Returns:
            背景顏色列表 [(R,G,B), ...]
        """
        # 轉為 RGB 數組
        if image.mode == 'RGBA':
            img_array = np.array(image)[:, :, :3]
        else:
            img_array = np.array(image.convert('RGB'))
        
        h, w = img_array.shape[:2]
        
        # 提取邊緣區域的像素（只取最外圍）
        margin = self.edge_margin
        edge_pixels = []
        
        # 四個邊緣區域
        edge_pixels.extend(img_array[0:margin, :].reshape(-1, 3))  # 上
        edge_pixels.extend(img_array[-margin:, :].reshape(-1, 3))  # 下
        edge_pixels.extend(img_array[:, 0:margin].reshape(-1, 3))  # 左
        edge_pixels.extend(img_array[:, -margin:].reshape(-1, 3))  # 右
        
        edge_pixels = np.array(edge_pixels)
        
        # 統計顏色出現次數（使用較大的量化步長來分組）
        quant_step = max(self.color_tolerance, 10)
        quantized = [(p[0]//quant_step*quant_step, p[1]//quant_step*quant_step, p[2]//quant_step*quant_step) 
                     for p in edge_pixels]
        
        color_counts = Counter(quantized)
        total_pixels = len(edge_pixels)
        
        # 找出主要顏色組
        main_color_groups = []
        for color, count in color_counts.most_common():
            ratio = count / total_pixels
            if ratio >= self.min_background_ratio:
                main_color_groups.append((color, count))
        
        # 如果沒有檢測到，使用最常見的
        if not main_color_groups and color_counts:
            main_color_groups = [(color_counts.most_common(1)[0][0], color_counts.most_common(1)[0][1])]
        
        # 從每個顏色組中計算平均顏色
        background_colors = []
        for group_color, _ in main_color_groups[:4]:  # 最多取4種主要顏色
            # 找出該組內的所有原始顏色
            group_pixels = []
            for p in edge_pixels:
                p_quant = (p[0]//quant_step*quant_step, p[1]//quant_step*quant_step, p[2]//quant_step*quant_step)
                if p_quant == group_color:
                    group_pixels.append(p)
            
            if group_pixels:
                # 計算平均顏色
                avg_color = tuple(int(np.mean([p[i] for p in group_pixels])) for i in range(3))
                background_colors.append(avg_color)
        
        return background_colors
    
    def remove_background(self, 
                          image: Image.Image,
                          background_colors: Optional[List[Tuple[int, int, int]]] = None) -> Image.Image:
        """
        去除背景
        
        Args:
            image: PIL Image 對象
            background_colors: 指定背景顏色（None則自動檢測）
            
        Returns:
            處理後的圖片（RGBA模式）
        """
        # 確保是 RGBA 模式
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        
        img_array = np.array(image)
        
        # 自動檢測背景顏色
        if background_colors is None:
            rgb_image = Image.fromarray(img_array[:, :, :3], 'RGB')
            background_colors = self.detect_background_colors(rgb_image)
        
        # 創建透明圖層
        h, w = img_array.shape[:2]
        is_background = np.zeros((h, w), dtype=bool)
        
        # 檢查每個像素是否為背景
        rgb = img_array[:, :, :3].astype(float)
        
        for bg_color in background_colors:
            bg_array = np.array(bg_color, dtype=float)
            # 計算每個像素與背景顏色的距離
            diff = np.abs(rgb - bg_array)
            # 判斷是否為背景（所有通道差異都在容忍度內）
            color_match = np.all(diff <= self.color_tolerance, axis=2)
            is_background |= color_match
        
        # 設為透明
        img_array[is_background, 3] = 0
        
        return Image.fromarray(img_array, 'RGBA')


def remove_background_universal(image_path: str, 
                                 output_path: str = None,
                                 color_tolerance: int = 25,
                                 background_colors: List[Tuple[int, int, int]] = None) -> str:
    """
    通用背景去除函數
    
    Args:
        image_path: 輸入圖片路徑
        output_path: 輸出路徑（可選）
        color_tolerance: 顏色相似度容忍度
        background_colors: 指定背景顏色（None則自動檢測）
        
    Returns:
        輸出圖片路徑
    """
    # 讀取圖片
    img = Image.open(image_path)
    
    # 去除背景
    remover = UniversalBackgroundRemover(color_tolerance=color_tolerance)
    result = remover.remove_background(img, background_colors)
    
    # 保存
    if output_path is None:
        output_path = str(Path(image_path).with_suffix('')) + '_no_bg.png'
    
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    result.save(output_path)
    
    return output_path


def split_stickers(image_path: str,
                   output_dir: str,
                   rows: int = 4,
                   cols: int = 3,
                   names: List[str] = None) -> List[str]:
    """
    將圖片按網格切割
    
    Args:
        image_path: 輸入圖片路徑
        output_dir: 輸出目錄
        rows: 行數
        cols: 列數
        names: 每個格子的名稱列表
        
    Returns:
        輸出文件路徑列表
    """
    img = Image.open(image_path)
    w, h = img.size
    cell_w, cell_h = w // cols, h // rows
    
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    if names is None:
        names = [f"sticker_{i+1:02d}" for i in range(rows * cols)]
    
    paths = []
    for i, name in enumerate(names[:rows*cols]):
        row, col = i // cols, i % cols
        cell = img.crop((col * cell_w, row * cell_h, (col+1) * cell_w, (row+1) * cell_h))
        path = f"{output_dir}/sticker_{i+1:02d}_{name}.png"
        cell.save(path)
        paths.append(path)
    
    return paths


def process_sticker_sheet_universal(input_path: str,
                                     output_dir: str,
                                     rows: int = 4,
                                     cols: int = 3,
                                     names: List[str] = None,
                                     color_tolerance: int = 25,
                                     background_colors: List[Tuple[int, int, int]] = None) -> dict:
    """
    通用貼圖處理流程：自動去背 + 切割
    
    Args:
        input_path: 輸入圖片路徑
        output_dir: 輸出目錄
        rows: 行數
        cols: 列數
        names: 貼圖名稱列表
        color_tolerance: 顏色相似度容忍度
        background_colors: 指定背景顏色（None則自動檢測）
        
    Returns:
        {'full': 完整圖路徑, 'stickers': 貼圖路徑列表, 'background_colors': 檢測到的背景顏色}
    """
    # 檢測背景顏色
    img = Image.open(input_path)
    remover = UniversalBackgroundRemover(color_tolerance=color_tolerance)
    detected_colors = remover.detect_background_colors(img)
    
    print(f"檢測到的背景顏色: {detected_colors}")
    
    # 去背
    transparent = remove_background_universal(
        input_path, 
        f"{output_dir}/transparent.png",
        color_tolerance=color_tolerance,
        background_colors=background_colors if background_colors else detected_colors
    )
    
    # 切割
    stickers = split_stickers(transparent, f"{output_dir}/stickers", rows, cols, names)
    
    return {
        'full': transparent,
        'stickers': stickers,
        'background_colors': detected_colors
    }


# ==================== 便捷函數 ====================

def remove_white_background(image_path: str, output_path: str = None) -> str:
    """快速去除白色背景"""
    return remove_background_universal(
        image_path, 
        output_path,
        color_tolerance=30,
        background_colors=[(255, 255, 255)]
    )


def remove_black_background(image_path: str, output_path: str = None) -> str:
    """快速去除黑色背景"""
    return remove_background_universal(
        image_path,
        output_path,
        color_tolerance=30,
        background_colors=[(0, 0, 0)]
    )


def remove_color_background(image_path: str, 
                            color: Tuple[int, int, int],
                            output_path: str = None,
                            tolerance: int = 30) -> str:
    """
    去除指定顏色的背景
    
    Args:
        image_path: 輸入圖片路徑
        color: 背景顏色 (R, G, B)
        output_path: 輸出路徑
        tolerance: 顏色容忍度
    """
    return remove_background_universal(
        image_path,
        output_path,
        color_tolerance=tolerance,
        background_colors=[color]
    )


# OpenClaw Skill 入口
skill = {
    'name': 'sticker_processor_universal',
    'description': '通用貼圖處理工具 - 自動檢測並去除任何顏色背景',
    'version': '2.1.0',
    'functions': {
        # 主要功能
        'process': process_sticker_sheet_universal,
        'remove_background': remove_background_universal,
        'split': split_stickers,
        
        # 快捷功能
        'remove_white': remove_white_background,
        'remove_black': remove_black_background,
        'remove_color': remove_color_background,
        
        # 檢測功能
        'detect_colors': lambda img_path: UniversalBackgroundRemover().detect_background_colors(Image.open(img_path))
    }
}
