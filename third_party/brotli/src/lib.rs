//! File compression C ABI for exactly the Brotli compression path in
//! httptoolkit/brotli-wasm v3.0.1/src/lib.rs. Modified for BTools file chunks; the upstream one-shot encoding path is retained.
//! Input/output remain one independent Brotli stream per <=4 MiB BTF2 block.
//!
//! ABI safety: the host owns the instance and must pass only live allocations
//! returned by bt_alloc, with the exact same length, after initializing every
//! input byte. No concurrent calls to one instance. Invalid raw pointers are UB.

use std::alloc::{alloc, dealloc, handle_alloc_error, Layout};
use std::slice;

const MAX_INPUT_BYTES: u32 = 4 * 1024 * 1024;

#[repr(C)]
pub struct CompressionResult {
    /// Pointer to an owned boxed output allocation. Read only until result_free.
    pub output_ptr: u32,
    pub output_len: u32,
    /// 0=success, 1=input too large/null, 2=invalid quality, 3=Brotli I/O error.
    pub status: u32,
    pub reserved: u32,
}

#[no_mangle]
pub extern "C" fn bt_abi_version() -> u32 {
    1
}

/// Allocate an uninitialized host input buffer; initialize all len bytes in JS.
/// A zero-length input still owns a one-byte allocation, freed with len=0.
#[no_mangle]
pub extern "C" fn bt_alloc(len: u32) -> *mut u8 {
    if len > MAX_INPUT_BYTES {
        return std::ptr::null_mut();
    }
    let layout = Layout::array::<u8>(len.max(1) as usize).unwrap();
    unsafe {
        let ptr = alloc(layout);
        if ptr.is_null() {
            handle_alloc_error(layout);
        }
        ptr
    }
}

#[no_mangle]
pub unsafe extern "C" fn bt_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() {
        return;
    }
    // Host contract: ptr/len must exactly identify a live bt_alloc allocation.
    let layout = Layout::array::<u8>(len.max(1) as usize).unwrap();
    dealloc(ptr, layout);
}

fn descriptor(output: Box<[u8]>, status: u32) -> *mut CompressionResult {
    let output_len = output.len() as u32;
    // Empty results need no allocation to reconstruct/free on the host side.
    let output_ptr = if output.is_empty() {
        0
    } else {
        Box::into_raw(output) as *mut u8 as u32
    };
    Box::into_raw(Box::new(CompressionResult {
        output_ptr,
        output_len,
        status,
        reserved: 0,
    }))
}

/// Return a 16-byte repr(C) descriptor, read as four little-endian uint32s.
/// This function borrows the input. The host must bt_free it after return.
#[no_mangle]
pub unsafe extern "C" fn bt_compress(
    ptr: *const u8,
    len: u32,
    quality: i32,
) -> *mut CompressionResult {
    if len > MAX_INPUT_BYTES || (len > 0 && ptr.is_null()) {
        return descriptor(Box::new([]), 1);
    }
    if !(1..=11).contains(&quality) {
        return descriptor(Box::new([]), 2);
    }
    let input: &[u8] = if len == 0 {
        &[]
    } else {
        slice::from_raw_parts(ptr, len as usize)
    };

    // Deliberately retain the official one-shot wrapper's allocation, reader,
    // default params and BrotliCompress call. Do not set lgwin, lgblock, mode,
    // size_hint, dictionaries, streaming buffer sizes or worker parameters.
    // https://github.com/httptoolkit/brotli-wasm/blob/v3.0.1/src/lib.rs#L40-L51
    let mut out = Vec::<u8>::new();
    let mut params = brotli::enc::BrotliEncoderParams::default();
    params.quality = quality;
    match brotli::BrotliCompress(&mut input.as_ref(), &mut out, &params) {
        Ok(_) => descriptor(out.into_boxed_slice(), 0),
        Err(_) => descriptor(Box::new([]), 3),
    }
}

/// Frees the descriptor and its complete output allocation together.
#[no_mangle]
pub unsafe extern "C" fn bt_result_free(ptr: *mut CompressionResult) {
    if ptr.is_null() {
        return;
    }
    let result = Box::from_raw(ptr);
    if result.output_ptr != 0 {
        let output = std::ptr::slice_from_raw_parts_mut(
            result.output_ptr as *mut u8,
            result.output_len as usize,
        );
        drop(Box::from_raw(output));
    }
}
